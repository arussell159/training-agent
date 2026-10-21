// Synthetic screenshot calibration only; never imported by the deployed server.
export function enduranceReferenceResponse(value) {
  if(!value || typeof value!=="object" || Array.isArray(value))return value;
  const result=structuredClone(value),settings=[
    {types:["Ride","Bike","VirtualRide"],ftp:197,power_zones:[55,75,90,105,1015.2284]},
    {types:["Run"],threshold_pace:1609.344/530,pace_zones:[80,90,95,100,999]},
    {types:["Swim"],threshold_pace:91.44/93,pace_zones:[80,90,95,105,999]},
  ];
  if(result.context)result.context=enduranceReferenceResponse(result.context);
  if(result.athlete?.sport_settings) {
    result.athlete.sport_settings=settings;
    result.athlete.zones={bike_ftp:197,run_threshold_pace:"8:50",swim_css:"1:33"};
    result.metrics={fitness:75,fatigue:45,form:24};
  }
  if(result.model?.sport)result.model.thresholds={ftp:197,pace:result.model.sport==="Swim"?91.44/93:1609.344/530};
  if(Array.isArray(result.zoneSettings))result.zoneSettings=settings;
  return result;
}
