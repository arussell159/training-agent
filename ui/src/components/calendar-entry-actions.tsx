import {Copy,Ellipsis,Pencil,Scissors,Trash2} from "lucide-react"
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger} from "./ui/dropdown-menu"

export function CalendarEntryActions({title,disabled,transferDisabled=false,editDisabled=false,onTransfer,onEdit,onDelete}:{title:string;disabled?:boolean;transferDisabled?:boolean;editDisabled?:boolean;onTransfer:(mode:"copy"|"cut")=>void;onEdit?:()=>void;onDelete?:()=>void}) {
  return <div className="calendar-entry-actions" onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}>
    <DropdownMenu>
      <DropdownMenuTrigger disabled={disabled} render={<button type="button" aria-label={`Calendar entry actions: ${title}`} className="calendar-entry-menu-trigger"/>}><Ellipsis size={16}/></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="calendar-context-menu">
        {onEdit&&<DropdownMenuItem disabled={disabled||editDisabled} onClick={onEdit}><Pencil/>Edit</DropdownMenuItem>}
        {((onEdit||onDelete)?["cut","copy"]:["copy","cut"]).map(mode=><DropdownMenuItem key={mode} disabled={disabled||transferDisabled} onClick={()=>onTransfer(mode as "copy"|"cut")}>{mode==="copy"?<Copy/>:<Scissors/>}{mode==="copy"?"Copy":"Cut"}</DropdownMenuItem>)}
        {onDelete&&<DropdownMenuItem variant="destructive" disabled={disabled} onClick={onDelete}><Trash2/>Delete</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
}
