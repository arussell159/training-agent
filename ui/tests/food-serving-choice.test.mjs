import test from 'node:test'
import assert from 'node:assert/strict'
import { preferredFoodServing } from '../src/lib/food-serving-choice.ts'
const serving = (id, label, calories) => ({id,label,unit:'serving',units:1,metricAmount:null,metricUnit:null,calories,protein:6,carbs:1,fat:5,fiber:0,catalogReceipt:'verified-'+id})
const product = (name, servings) => ({source:'fatsecret',name,code:'food',servingId:servings[0].id,servingSize:servings[0].label,nutrients:servings[0],servings})
test('egg search uses one catalog egg and its actual calories rather than 100 grams', () => {
 const source=product('Egg',[serving('grams','100 g',155),serving('cup','1 cup',211),serving('egg','1 large',70)])
 const selected=preferredFoodServing(source)
 assert.equal(selected.servingId,'egg'); assert.equal(selected.servingSize,'1 large'); assert.equal(selected.nutrients.calories,70)
 assert.equal(selected.servings.find(s=>s.id===selected.servingId).catalogReceipt,'verified-egg')
 assert.equal(source.servingId,'grams')
})
test('packaged chips select the supplied one-bag portion without making up calories', () => {
 const source=product('Potato chips',[serving('grams','100 g',536),serving('oz','1 oz',152),serving('bag','1 bag',150)])
 const selected=preferredFoodServing(source)
 assert.equal(selected.servingId,'bag'); assert.equal(selected.servingSize,'1 bag'); assert.equal(selected.nutrients.calories,150)
 source.servings[2].calories=210
 assert.equal(preferredFoodServing(source).nutrients.calories,210)
})
test('metric-only foods, missing servings and other catalogs keep available facts', () => {
 const metric=product('Chicken',[serving('grams','100 g',165)])
 assert.equal(preferredFoodServing(metric).servingId,'grams')
 const unresolved={source:'fatsecret',name:'Egg',servings:[],nutrients:{calories:155}}
 assert.equal(preferredFoodServing(unresolved),unresolved)
 const other={...metric,source:undefined};assert.equal(preferredFoodServing(other),other)
})
test('ties preserve catalog order and retain all portion choices for manual editing',()=>{
 const source=product('Apple',[serving('a','1 medium',95),serving('b','1 piece',100)])
 const selected=preferredFoodServing(source)
 assert.equal(selected.servingId,'a');assert.equal(selected.servings,source.servings)
})
