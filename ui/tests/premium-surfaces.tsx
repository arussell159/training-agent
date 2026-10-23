import { createRoot } from "react-dom/client"
import { Button } from "../src/components/ui/button"
import { Input } from "../src/components/ui/input"
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "../src/components/ui/dialog"
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "../src/components/ui/alert-dialog"
import { useMobileViewport } from "../src/hooks/use-mobile-viewport"
import "../src/index.css"
import "../src/styles/framework7-navbar.less"

function Surfaces() {
  useMobileViewport()
  return <main className="p-4" style={{ minHeight: "200vh" }}>
    <Dialog>
      <DialogTrigger render={<Button />}>Edit draft</DialogTrigger>
      <DialogContent>
        <DialogTitle>Edit workout</DialogTitle>
        <DialogDescription>Changes remain in this draft until saved.</DialogDescription>
        <label>Workout title<Input aria-label="Workout title" defaultValue="Morning swim" /></label>
        <p>{"A very long workout description should wrap and remain readable. ".repeat(35)}</p>
        <DialogFooter><DialogClose render={<Button variant="outline" />}>Cancel edit</DialogClose><Button>Save workout</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="destructive" />}>Delete fixture</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Delete this workout?</AlertDialogTitle>
        <AlertDialogDescription>This removes the selected workout from your calendar. Cancel to keep it.</AlertDialogDescription>
        <AlertDialogFooter><AlertDialogCancel>Keep workout</AlertDialogCancel><Button variant="destructive">Delete workout</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </main>
}
createRoot(document.getElementById("root")!).render(<Surfaces />)
