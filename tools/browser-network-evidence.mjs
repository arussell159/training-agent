// Synthetic-browser diagnostics only. Never records headers, cookies or bodies.
export function browserNetworkEvidence() {
  const entries=[],attached=new WeakSet();
  const attachPage=page=>{
    if(attached.has(page))return;attached.add(page);
    page.on("response",response=>{if(response.status()>=400)entries.push({kind:"http-error",status:response.status(),method:response.request().method(),resourceType:response.request().resourceType(),url:response.url()});});
    page.on("requestfailed",request=>entries.push({kind:"request-failed",method:request.method(),resourceType:request.resourceType(),url:request.url(),reason:request.failure()?.errorText || "Unknown failure"}));
    page.on("console",message=>{if(message.type()==="error")entries.push({kind:"console-error",text:message.text()});});
    page.on("pageerror",error=>entries.push({kind:"page-error",message:error.message}));
  };
  return {entries,attach(context){context.pages().forEach(attachPage);context.on("page",attachPage);}};
}
