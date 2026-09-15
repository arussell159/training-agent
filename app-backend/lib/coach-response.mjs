import {TRANSPORT_INSTRUCTIONS,triathlonCoachTools,createIntervalsCoachAdapter} from './triathlon-coach-adapter.mjs';

export async function generateCoachResponse(config,{guide,currentDate,context,history = [],message,executeTool},fetchImpl = fetch) {
  const tools = await triathlonCoachTools();
  const runTool = executeTool || createIntervalsCoachAdapter();
  const input = [...history.filter(item => ['user','assistant'].includes(item.role)).map(item => ({role:item.role,content:String(item.content || '')})),{role:'user',content:message}];
  let calls = 0;
  for (let round = 0; round < 8; round++) {
    const response = await fetchImpl('https://api.openai.com/v1/responses',{
      method:'POST',headers:{Authorization:`Bearer ${config.OPENAI_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:config.OPENAI_MODEL || 'gpt-5-mini',store:false,max_output_tokens:5000,reasoning:{effort:'high'},instructions:`${guide}\n\n${TRANSPORT_INSTRUCTIONS}\nAthlete local date: ${currentDate}.`,input,tools,tool_choice:calls >= 12 ? 'none' : 'auto'}),
    });
    if (!response.ok) throw new Error(`OpenAI request failed (${response.status})`);
    const data = await response.json();
    const output = data.output || [];
    const requests = output.filter(item => item.type === 'function_call');
    if (!requests.length) {
      const text = data.output_text || output.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n');
      if (!text?.trim()) throw new Error('OpenAI returned an empty coach response');
      return text;
    }
    input.push(...output);
    for (const request of requests) {
      let result;
      try { result = ++calls > 12 ? {error:'Read budget reached. Answer using retrieved data.'} : await runTool(request.name,JSON.parse(request.arguments || '{}')); }
      catch { result = {error:'Intervals.icu read failed. Requested data is unavailable; do not invent it.'}; }
      input.push({type:'function_call_output',call_id:request.call_id,output:JSON.stringify(result)});
    }
  }
  throw new Error('Coach exceeded the bounded tool workflow; please narrow the request');
}
