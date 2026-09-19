import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from datetime import date

# The publisher's HTTP dependency is substituted; tests cannot reach Intervals.
stub = types.ModuleType("post_workout_report")
for key, value in dict(BASE_URL="https://intervals.invalid", READ_TIMEOUT=30, WRITE_TIMEOUT=30,
                      build_report=Mock(return_value="post text"), get_activity=Mock(return_value={'icu_chat_id': 123}), get_messages=Mock(return_value=[]),
                      headers=lambda key: {}, match_plan=lambda a, p: next((x for x in p if x.get("name") == a.get("name")), None),
                      message_text=lambda m: (m or {}).get("content", ""),
                      requests=types.SimpleNamespace(post=Mock(), put=Mock(), RequestException=RuntimeError)).items():
    setattr(stub, key, value)
sys.modules["post_workout_report"] = stub
spec = importlib.util.spec_from_file_location("workout_reports", Path(__file__).with_name("workout_reports.py"))
reports = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reports)


class ReportsTest(unittest.TestCase):
    activity = {'id': 'i42', 'name': 'Morning ride', 'type': 'Ride', 'date': '2026-09-19T07:00:00'}
    combined = "[[SECTION11_REPORT:POST_WORKOUT:i42]]\nSummary: Morning ride completed\n\nRun — Brick run\nStart time: 10:00 AM\nHR: 170\n\nRide — Morning ride\nStart time: 7:00 AM\nPower: 150\n\nWeekly totals (rolling 7d)\nHours: 9\n\nOverall\nSaved interpretation\n[[/SECTION11_REPORT:POST_WORKOUT:i42]]"

    def test_legacy_correction_preserves_only_selected_session_and_original_context(self):
        text = reports.session_only_post(self.combined, self.activity)
        self.assertNotIn('Brick run', text)
        self.assertNotIn('HR: 170', text)
        self.assertIn('Power: 150', text)
        self.assertTrue(text.endswith(self.combined.split('Weekly totals')[1]))
        self.assertEqual(reports.session_only_post(text, self.activity), text)
        self.assertEqual(reports.session_only_post(self.combined, {**self.activity, 'name': 'Unknown'}), self.combined)
        self.assertEqual(reports.session_only_post('Custom authored report', self.activity), 'Custom authored report')

    def test_same_name_sessions_use_the_saved_start_time(self):
        combined = self.combined.replace('Run — Brick run', 'Ride — Morning ride')
        text = reports.session_only_post(combined, self.activity)
        self.assertNotIn('10:00 AM', text)
        self.assertIn('7:00 AM', text)

    def test_repairs_existing_comment_in_place_and_verifies_content(self):
        before = {'id': 55, 'activity_id': 'i42', 'content': self.combined}
        after = {**before, 'content': reports.session_only_post(self.combined, self.activity)}
        with patch.object(reports, 'get_messages', side_effect=[[before], [after]]), patch.object(stub.requests, 'put') as put, patch.object(stub.requests, 'post') as post:
            self.assertEqual(reports.repair_post(self.activity, 'test', [before]), 'session_corrected_and_verified')
            self.assertEqual(put.call_args.args[0], 'https://intervals.invalid/chats/123/messages/55')
            self.assertEqual(put.call_args.kwargs['json'], {'content': after['content']})
            post.assert_not_called()

    def test_concurrent_edit_stops_correction(self):
        before = {'id': 55, 'content': self.combined}
        with patch.object(reports, 'get_messages', return_value=[{'id': 55, 'content': 'Edited'}]), patch.object(stub.requests, 'put') as put:
            with self.assertRaisesRegex(RuntimeError, 'changed before correction'):
                reports.repair_post(self.activity, 'test', [before])
            put.assert_not_called()

    def test_archive_is_same_day_and_strictly_before_start(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / "2026-09"
            folder.mkdir()
            for stamp in ("20260918_220000", "20260919_105300", "20260919_121000"):
                iso = f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:8]}T{stamp[9:11]}:{stamp[11:13]}:00"
                (folder / f"{stamp}.json").write_text(json.dumps({"metadata": {"last_updated": iso}}))
            found = reports.pre_snapshot({"date": "2026-09-19T07:09:00"}, root)
            self.assertEqual(found["metadata"]["last_updated"], "2026-09-19T10:53:00")
            self.assertIsNone(reports.pre_snapshot({"date": "2026-09-19T00:00:00"}, root))

    def test_pre_report_does_not_use_post_session_readiness_or_invent_checkin(self):
        snapshot = {"metadata": {"last_updated": "2026-09-19T10:53:00"},
                    "readiness_decision": {"recommendation": "modify", "reason": "Recorded reason", "signals": {"acwr": {"value": 0.7}}},
                    "derived_metrics": {"acwr": 1.8},
                    "recent_activities": [{"date": "2026-09-19T06:00:00"}]}
        text = reports.build_pre_report(snapshot, {"date": "2026-09-19T08:00:00"})
        self.assertIn("ACWR: 0.7; start-of-day", text)
        self.assertNotIn("1.8", text)
        self.assertIn("no continuation decision is inferred", text)
        self.assertIn("Archived readiness baseline: modify", text)
        self.assertNotIn("Recommendation:", text)
        self.assertIn("unavailable", reports.build_pre_report(None, {"date": "2026-09-19T08:00:00"}))

    def test_existing_comment_is_never_reposted(self):
        marker = "[[SECTION11_REPORT:POST_WORKOUT:i42]]"
        with patch.object(reports, "get_messages", return_value=[{"content": marker}]), patch.object(stub.requests, "post") as post:
            self.assertEqual(reports.publish_once("i42", "test", "POST_WORKOUT", "report"), "already_saved")
            post.assert_not_called()

    def test_uncertain_write_reads_back_before_retry(self):
        marker = "[[SECTION11_REPORT:PRE_WORKOUT:i42]]"
        with patch.object(reports, "get_messages", side_effect=[[], [{"content": marker}]]), patch.object(stub.requests, "post", side_effect=RuntimeError("timeout")) as post:
            self.assertEqual(reports.publish_once("i42", "test", "PRE_WORKOUT", "report"), "verified_after_write")
            self.assertEqual(post.call_count, 1)

    def test_unpaired_completion_and_midnight_catchup_get_both_reports(self):
        latest = {"recent_activities": [
            {"id": "new", "date": "2026-09-19T07:00:00"},
            {"id": "yesterday", "date": "2026-09-18T23:59:00"},
            {"id": "old", "date": "2026-09-15T07:00:00"}]}
        with patch.object(reports, "get_messages", return_value=[]), patch.object(reports, "build_report", return_value='post') as build, patch.object(reports, "pre_snapshot", return_value=None), patch.object(reports, "publish_once", return_value="saved") as publish:
            result = reports.run(latest, {}, "test", date(2026, 9, 19))
            self.assertEqual(len(result), 4)
            self.assertEqual([c.args[0]['recent_activities'] for c in build.call_args_list], [[latest['recent_activities'][0]], [latest['recent_activities'][1]]])
            self.assertEqual(len(latest['recent_activities']), 3)
            self.assertEqual([c.args[:3:2] for c in publish.call_args_list], [("new", "PRE_WORKOUT"), ("new", "POST_WORKOUT"), ("yesterday", "PRE_WORKOUT"), ("yesterday", "POST_WORKOUT")])


if __name__ == "__main__":
    unittest.main()
