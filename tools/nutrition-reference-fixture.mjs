// Screenshot calibration only. Runs behind --nutrition-reference in the
// disposable preview; never loads a real account or provider.
export function nutritionReferenceFixture(fixture) {
 const entries=[
  ['Thirst Quencher Fruit Punch (20 oz)',2,'bottle',280,0,0,72],
  ['Mini Pretzels',1,'19 pretzels',110,3,1,23],
  ['Chicken Salad Wrap',1,'wrap',370,14,21,32],
  ['Sunflower Seeds',1,'1/4 cup',150,6,14,7],
  ['Remaining daily foods',1,'serving',1572,94,77,124],
 ].map(([name,quantity,unit,calories,protein,fat,carbs],index)=>({id:`reference-food-${index}`,name,quantity,unit,calories,protein,fat,carbs,fiber:null,source:'manual',meal:index===4?'dinner':'lunch',time:index===4?'18:00':'12:00',notes:'Synthetic screenshot fixture',barcode:null,imageUrl:null}));
 const targets={calories:2940,protein:221,fat:81,carbs:330,fiber:null};
 return {...fixture,context:(...args)=>({...fixture.context(...args),history:[],planned:[]}),nutrition:date=>{
   const base=fixture.nutrition(date);
   return {...base,targets,day:{entries:structuredClone(entries),revision:1},week:base.week.map(day=>({...day,targets}))};
 }};
}
