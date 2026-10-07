import { registerFramework7Modules } from "./framework7-modules"
import Calendar from "framework7/components/calendar"

// This module follows the lazy calendar route. Passing module objects installs
// them synchronously, including onto an already-created Framework7 instance.
registerFramework7Modules(Calendar)
