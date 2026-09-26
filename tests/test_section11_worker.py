import importlib.util
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch


# These tests exercise subprocess setup and error redaction without networking.
spec = importlib.util.spec_from_file_location(
    "section11_worker", Path(__file__).resolve().parents[1] / "api" / "section11_worker.py"
)
worker = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {"requests": ModuleType("requests")}):
    spec.loader.exec_module(worker)


class ExportRuntimeTests(unittest.TestCase):
    def test_child_inherits_bundled_dependencies_without_app_secrets(self):
        with TemporaryDirectory() as bundled, TemporaryDirectory() as working:
            Path(bundled, "bundled_dependency.py").write_text("VALUE = 'available'\n")
            with patch.object(sys, "path", [bundled, *sys.path]), patch.dict(
                os.environ, {"TRAINING_DATA_GITHUB_TOKEN": "private-token", "APP_PASSWORD": "private-password"}
            ):
                environment = worker.export_environment({
                    "athlete_id": "i123", "intervals_key": "provider-key",
                })
            self.assertNotIn("TRAINING_DATA_GITHUB_TOKEN", environment)
            self.assertNotIn("APP_PASSWORD", environment)
            result = subprocess.run(
                [sys.executable, "-c", "import bundled_dependency; print(bundled_dependency.VALUE)"],
                cwd=working, env=environment, capture_output=True, timeout=10,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), b"available")

    def test_error_reports_missing_module_without_stdout_or_traceback(self):
        result = SimpleNamespace(
            returncode=1, stdout=b"private health data and credential-prefix",
            stderr=b"Traceback private-path\nModuleNotFoundError: No module named 'requests'\n",
        )
        message = worker.export_failure(result)
        self.assertIn("dependency requests", message)
        self.assertNotIn("private", message)
        self.assertNotIn("credential", message)

    def test_error_reports_only_exception_type(self):
        result = SimpleNamespace(returncode=1, stderr=b"ValueError: private data and key\n")
        self.assertEqual(worker.export_failure(result), "Section 11 export failed (exit 1, ValueError).")


if __name__ == "__main__":
    unittest.main()
