import * as React from "react";import{cn}from"@/lib/utils"
export const Card=React.forwardRef<HTMLDivElement,React.HTMLAttributes<HTMLDivElement>>(({className,...p},r)=><div ref={r} className={cn("card",className)} {...p}/>);Card.displayName="Card"
export const CardHeader=({className,...p}:React.HTMLAttributes<HTMLDivElement>)=><div className={cn("card-header",className)} {...p}/>
export const CardContent=({className,...p}:React.HTMLAttributes<HTMLDivElement>)=><div className={cn("card-content",className)} {...p}/>
