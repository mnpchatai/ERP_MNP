export function calculate(x){
 for(const k of ['quantity','perFg','yield','weight','batch','increment'])if(!Number.isFinite(x[k])||x[k]<=0)throw Error('ค่าต้องมากกว่าศูนย์: '+k);
 for(const k of ['stock','setup','joint','scrap'])if(!Number.isFinite(x[k])||x[k]<0)throw Error('ค่าไม่ถูกต้อง: '+k);
 for(const k of ['quantity','perFg','yield','stock'])if(!Number.isSafeInteger(x[k]))throw Error('จำนวนต้องเป็นจำนวนเต็ม: '+k);
 if(x.joint>100||x.scrap>100)throw Error('เปอร์เซ็นต์ต้องไม่เกิน 100');
 const pieces=x.quantity*x.perFg,required=Math.ceil(pieces/x.yield),produce=Math.max(0,required-x.stock),net=produce*x.weight/1000;
 const joint=net*x.joint/100,scrap=net*x.scrap/100,setup=produce?x.setup:0,total=net+joint+scrap+setup;
 const rounded=total?Math.ceil(Number((total/x.increment).toFixed(10)))*x.increment:0;
 const result={pieces,required,produce,net,joint,scrap,setup,total,rounded,batches:rounded/x.batch,extra:rounded-total};
 if(Object.values(result).some(v=>!Number.isFinite(v)||v>Number.MAX_SAFE_INTEGER))throw Error('จำนวนมากเกินขอบเขตการคำนวณ');
 return result;
}
