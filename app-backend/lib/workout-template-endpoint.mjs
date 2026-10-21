import {
  workoutTemplateId,
  workoutTemplateScope,
  workoutTemplateOperation,
} from "./workout-template-model.mjs";

// Authentication is supplied by the application before dispatch. The actor is
// passed per request; neither service instances nor current actor are global.
export function createWorkoutTemplateEndpoint({ readConfig, readBody, service }) {
  return async (req, res, pathname) => {
    const url = new URL(req.url, "http://localhost"),
      path = pathname || url.pathname;
    const save = path.match(/^\/api\/workouts\/(event(?::|%3A)[1-9]\d*)\/save-template$/i);
    const inspect = path.match(/^\/api\/workout-template-operations\/([0-9a-f-]{36})$/i);
    const folders = path === "/api/workout-library/folders",
      list = path === "/api/workout-library";
    if (!save && !inspect && !folders && !list) return false;
    const send = (status, body) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(body));
    };
    try {
      if (
        !req.appActor ||
        typeof req.appActor.id !== "string" ||
        typeof req.appActor.readOnly !== "boolean"
      )
        throw Object.assign(Error("Sign in to the workout library."), {
          status: 401,
          code: "TEMPLATE_AUTH",
        });
      if (req.method !== (save ? "POST" : "GET"))
        throw Object.assign(Error("This library action uses a different request method."), {
          status: 405,
          code: "TEMPLATE_METHOD",
        });
      const allowed = inspect ? ["accountScope"] : [];
      if (
        [...url.searchParams.keys()].some((key) => !allowed.includes(key)) ||
        (inspect && url.searchParams.getAll("accountScope").length !== 1)
      )
        throw Object.assign(Error("Choose valid library request parameters."), {
          status: 400,
          code: "TEMPLATE_INVALID",
        });
      const current = service(await readConfig(), req.appActor);
      const result = folders
        ? await current.listFolders()
        : list
          ? await current.listTemplates()
          : inspect
            ? await current.inspect(inspect[1], url.searchParams.get("accountScope"))
            : await current.save(decodeURIComponent(save[1]), await readBody(req));
      send(200, result);
    } catch (error) {
      const known = typeof error.code === "string" && /^TEMPLATE_[A-Z_]+$/.test(error.code),
        status =
          known && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
            ? error.status
            : 502;
      const body = {
        error: known
          ? error.message
          : "The template operation could not be confirmed. Recheck the same request.",
        code: known ? error.code : "TEMPLATE_UNCONFIRMED",
      };
      if (
        error.code === "TEMPLATE_REPLAY_CHANGED" &&
        workoutTemplateId(error.workoutId) &&
        workoutTemplateScope(error.accountScope) &&
        workoutTemplateOperation(error.operationId)
      )
        Object.assign(body, {
          workoutId: error.workoutId,
          accountScope: error.accountScope,
          operationId: error.operationId,
        });
      send(status, body);
    }
    return true;
  };
}
