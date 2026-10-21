# Strength hydration cancellation review

The first Strength10 run on frozen build 91820 completed all ten functional groups, including native/private readback, fresh direct reopen, manual values and rejected/held/confirmed deletion. Its final network gate failed on one `GET workouts/event:9014/editor` with `net::ERR_ABORTED`. There were no page errors. Preserve `artifacts/frozen91820-strength-aborted-hydration-failure`; the canceled request is real evidence, not a clean first run.

An ordinary fresh repeat passed all ten groups with the same strict gate. The later runner records request/response/finished/failed timestamps and operation phases. A read-only observer also records context and editor-save events. Separate bounded diagnostics held the first and second post-save hydration GETs. Neither reproduced cancellation. The second remained alive through deletion and was released after three seconds. Their results are diagnostic only, not acceptance evidence; these runs do not establish the exact original cancellation stack.

The source has an ordinary supersession path:

1. `App.tsx` updates the selected workout object when the central training context publishes a same-ID row. `use-edited-workout.ts` also updates from context changes and `workout-editor-saved`.
2. `WorkoutEditor`'s hydration effect depends on the complete `workout` object. Replacing that object cleans up the prior effect with `controller.abort()` and starts a new consumer for the same editor URL.
3. `createSharedRequestCache` releases the old consumer and aborts its transport when no consumers remain and it is still the registered request. Invalidation can detach a request first, explaining why the held diagnostics can keep an obsolete transport alive instead.
4. The hydration catch ignores an aborted consumer. The effect does not clear `loaded`. `EditorWorkspace` keeps the same ID/reload key and initializes model history with `useState`; replacing the parent's hydration result does not reset the working model or dismiss the modal. Explicit Reload uses a different path and key.
5. Save separately awaits the real editor write before committing the verified workout, updating revision/baselines and notifying the parent. A later canceled read does not turn a confirmed write into an unconfirmed one.

This makes ordinary supersession a supported explanation, rather than evidence of a lost save or erased draft. It remains an inference for the original uninstrumented cancellation. No product fix or broad request-failure exception was made. The runner's acceptance gate still rejects unexpected aborted requests. Any future exception should identify a superseded read from actual lifecycle evidence and retain unrelated aborts as failures.

The next useful isolation, if this recurs, is a diagnostic transport/signal correlation captured before the failure. Repeating broad suites or changing product cache behavior solely to make a blanket network gate green would not establish a user-visible defect.
