import test from 'node:test';
import assert from 'node:assert/strict';
import {copyNutritionFoods,readNutritionClipboard,pastedNutritionFoods,clearNutritionClipboard} from '../src/lib/nutrition-planner.ts';
import {beginFoodGesture,moveFoodGesture,finishFoodGesture} from '../src/lib/native-food-gesture.ts';
const food={id:'original-food',name:'Rice',meal:'lunch',quantity:2,unit:'cup',calories:400,protein:8,carbs:90,fat:1,fiber:null,source:'manual',notes:'',barcode:null,imageUrl:null};
test('session copying preserves the food and creates fresh IDs for a destination meal',()=>{
 const copied=copyNutritionFoods('account-a','2026-10-26',[food],'Rice',1000),pasted=pastedNutritionFoods(copied,'account-a','breakfast',()=> 'copied-food-1',1001);
 assert.equal(pasted[0].meal,'breakfast');assert.notEqual(pasted[0].id,food.id);pasted[0].quantity=50;assert.equal(food.quantity,2);assert.equal(readNutritionClipboard('account-a',1001).entries[0].quantity,2);
});
test('copies are account scoped, expire, and clear without writing browser storage',()=>{
 copyNutritionFoods('account-a','2026-10-26',[food],'Rice',1000);assert.equal(readNutritionClipboard('account-b',1001),null);assert.equal(readNutritionClipboard('account-a',86401000),null);
 copyNutritionFoods('account-a','2026-10-26',[food],'Rice',1000);clearNutritionClipboard();assert.equal(readNutritionClipboard('account-a',1001),null);
 assert.throws(()=>copyNutritionFoods('initial','2026-10-26',[food],'Rice',1000));
});
test('expired provider facts and invalid portions are not copied',()=>{
 assert.throws(()=>copyNutritionFoods('account-a','2026-10-26',[{...food,catalogExpiresAt:999}],'Rice',1000));for(const patch of [{quantity:0},{fat:-1},{calories:NaN},{name:''}])assert.throws(()=>copyNutritionFoods('account-a','2026-10-26',[{...food,...patch}],'Rice',1000));
});
test('taps, holds and moved gestures retain distinct actions',()=>{
 assert.equal(finishFoodGesture(beginFoodGesture(100,200,1000),1499),'tap');assert.equal(finishFoodGesture(beginFoodGesture(100,200,1000),1500),'hold');const moved=beginFoodGesture(100,200,1000);moveFoodGesture(moved,100,210);assert.equal(finishFoodGesture(moved,1700),'cancel');
});
