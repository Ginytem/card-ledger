# -*- coding: utf-8 -*-
# 构建卡账记演示站：从 worker.js 提取前端模板 + 注入本地模拟数据层
import io, sys

SRC = 'E:/card-ledger/worker.js'
OUT = 'E:/card-ledger/demo/index.html'

src = io.open(SRC, encoding='utf-8').read()
start = src.index('<!DOCTYPE html>')
end = src.index('</html>') + len('</html>')
html = src[start:end]

# 转义降级：worker.js 模板字符串中的 \\X 在提取为内联脚本后应还原为 \X
# （否则 \\' 在内联脚本中会被解析为 反斜杠+字符串结束，导致整页 SyntaxError）
html = html.replace("\\\\'", "\\'")       # \\'  -> \'   （onclick 内嵌 JS）
html = html.replace("\\\\d", "\\d")       # \\d  -> \d   （正则 \d{4}）
html = html.replace("\\\\uFEFF", "\\uFEFF")  # 导出 CSV BOM
html = html.replace("\\\\n", "\\n")       # \\n  -> \n   （CSV 行连接）

mock = r'''
<script>
/* ============ 卡账记演示模式 ============
   数据层：所有 /api/* 请求由本地 localStorage 模拟，含内置虚拟数据。
   免登录进入；增删改查仅保存在当前浏览器，刷新不丢。 */
(function(){
  var DB_KEY='cardledger_demo_v1';
  function today(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function seed(){
    return {
      cards:[
        {id:1,bank_name:'招商银行',card_type:'经典白',last_4_digits:'1234',status:'normal',card_limit:120000,temp_limit:0,temp_limit_expiry:'',billing_day:25,payment_type:'fixed_day',payment_value:13,grace_days:0,max_grace_period:48,annual_fee:3600,annual_fee_start:'2026-01-01',annual_fee_end:'2026-12-31',used_amount:45800,notes:'刷6次免年费',paid_through:''},
        {id:2,bank_name:'中信银行',card_type:'i白金',last_4_digits:'5678',status:'normal',card_limit:60000,temp_limit:20000,temp_limit_expiry:'2026-11-30',billing_day:8,payment_type:'days_after_billing',payment_value:20,grace_days:0,max_grace_period:50,annual_fee:480,annual_fee_start:'2026-01-01',annual_fee_end:'2026-12-31',used_amount:15300,notes:'',paid_through:''},
        {id:3,bank_name:'交通银行',card_type:'沃尔玛金',last_4_digits:'9012',status:'normal',card_limit:35000,temp_limit:0,temp_limit_expiry:'',billing_day:10,payment_type:'fixed_day',payment_value:4,grace_days:0,max_grace_period:56,annual_fee:200,annual_fee_start:'2025-01-01',annual_fee_end:'2025-12-31',used_amount:12800,notes:'',paid_through:'2026-10-04'},
        {id:4,bank_name:'建设银行',card_type:'大山白',last_4_digits:'3456',status:'normal',card_limit:80000,temp_limit:0,temp_limit_expiry:'',billing_day:15,payment_type:'fixed_day',payment_value:5,grace_days:0,max_grace_period:50,annual_fee:1800,annual_fee_start:'2026-03-01',annual_fee_end:'2027-02-28',used_amount:66000,notes:'积分兑换免年费',paid_through:''},
        {id:5,bank_name:'广发银行',card_type:'犀利卡',last_4_digits:'7890',status:'normal',card_limit:50000,temp_limit:0,temp_limit_expiry:'',billing_day:12,payment_type:'fixed_day',payment_value:2,grace_days:0,max_grace_period:50,annual_fee:0,annual_fee_start:'',annual_fee_end:'',used_amount:8000,notes:'',paid_through:'2026-10-02'},
        {id:6,bank_name:'农业银行',card_type:'悠然白',last_4_digits:'2468',status:'normal',card_limit:45000,temp_limit:0,temp_limit_expiry:'',billing_day:16,payment_type:'fixed_day',payment_value:10,grace_days:0,max_grace_period:54,annual_fee:0,annual_fee_start:'',annual_fee_end:'',used_amount:9000,notes:'',paid_through:''}
      ],
      bills:[
        {id:1,card_id:3,bill_date:'2026-09-10',amount:12800,min_payment:1280,due_date:'2026-10-04',paid:0,paid_date:'',notes:''},
        {id:2,card_id:2,bill_date:'2026-09-08',amount:15300,min_payment:1530,due_date:'2026-09-28',paid:1,paid_date:'2026-09-26',notes:''},
        {id:3,card_id:6,bill_date:'2026-09-16',amount:9000,min_payment:900,due_date:'2026-10-10',paid:0,paid_date:'',notes:''},
        {id:4,card_id:4,bill_date:'2026-09-15',amount:22000,min_payment:2200,due_date:'2026-10-05',paid:0,paid_date:'',notes:''},
        {id:5,card_id:1,bill_date:'2026-09-25',amount:45800,min_payment:4580,due_date:'2026-10-13',paid:0,paid_date:'',notes:''},
        {id:6,card_id:5,bill_date:'2026-09-12',amount:8000,min_payment:800,due_date:'2026-10-02',paid:1,paid_date:'2026-10-01',notes:''}
      ],
      fee_rules:[
        {id:1,card_id:1,condition_type:'times',target_value:6,current_value:3,cycle_start:'2026-01-01',cycle_end:'2026-12-31',annual_fee:3600,status:'active'},
        {id:2,card_id:2,condition_type:'times',target_value:6,current_value:5,cycle_start:'2026-01-01',cycle_end:'2026-12-31',annual_fee:480,status:'active'},
        {id:3,card_id:3,condition_type:'amount',target_value:100000,current_value:100000,cycle_start:'2025-01-01',cycle_end:'2025-12-31',annual_fee:200,status:'waived'},
        {id:4,card_id:4,condition_type:'points',target_value:10000,current_value:4200,cycle_start:'2026-03-01',cycle_end:'2027-02-28',annual_fee:1800,status:'active'},
        {id:5,card_id:6,condition_type:'amount',target_value:50000,current_value:42000,cycle_start:'2025-01-01',cycle_end:'2025-12-31',annual_fee:0,status:'failed'}
      ],
      limit_changes:[
        {id:1,card_id:1,old_limit:100000,new_limit:120000,change_type:'permanent',effective_date:'2026-08-15',reason:'银行主动提额',created_at:'2026-08-15 09:00:00'},
        {id:2,card_id:2,old_limit:60000,new_limit:80000,change_type:'temporary',effective_date:'2026-09-01',reason:'临时额度申请',created_at:'2026-09-01 10:00:00'}
      ],
      settings:{payment_advance_days:'1',enable_pushplus:'1',enable_email:'0'}
    };
  }
  var db;
  try{ db=JSON.parse(localStorage.getItem(DB_KEY)); }catch(e){ db=null; }
  if(!db || !db.cards){ db=seed(); save(); }
  function save(){ try{ localStorage.setItem(DB_KEY,JSON.stringify(db)); }catch(e){} }
  function nextId(arr){ return arr.reduce(function(m,x){ return Math.max(m,x.id); },0)+1; }
  function j(data,status){ return new Response(JSON.stringify(data),{status:status||200,headers:{'Content-Type':'application/json;charset=utf-8'}}); }
  function num(v){ return v===undefined||v===null||v===''?0:Number(v); }
  function todayStr(){ return today(); }

  async function mock(url,init){
    var u=new URL(url,location.origin);
    var p=u.pathname, m=(init&&init.method)||'GET', body={};
    try{ body=init&&init.body?JSON.parse(init.body):{}; }catch(e){}
    // 登录：任意账号密码均可
    if(p==='/api/login'&&m==='POST'){ return j({success:true,token:'demo-token',username:body.username||'演示用户'}); }
    // 卡片列表 / 新增
    if(p==='/api/cards'&&m==='GET'){ return j({success:true,cards:db.cards}); }
    if(p==='/api/cards'&&m==='POST'){
      var c=body; c.id=nextId(db.cards);
      c.card_limit=num(c.card_limit); c.temp_limit=num(c.temp_limit||0);
      c.annual_fee=num(c.annual_fee); c.used_amount=num(c.used_amount);
      c.billing_day=num(c.billing_day)||1; c.payment_value=num(c.payment_value)||1;
      db.cards.push(c); save(); return j({success:true,id:c.id});
    }
    // 卡片详情 / 编辑 / 删除
    var m1=p.match(/^\/api\/cards\/(\d+)$/);
    if(m1){
      var id=Number(m1[1]), idx=-1;
      for(var i=0;i<db.cards.length;i++){ if(db.cards[i].id===id){ idx=i; break; } }
      if(idx<0) return j({success:false,message:'卡片不存在'},404);
      if(m==='GET'){
        return j({success:true,card:db.cards[idx],
          limitChanges:db.limit_changes.filter(function(x){return x.card_id===id;}).sort(function(a,b){return b.effective_date.localeCompare(a.effective_date);}),
          bills:db.bills.filter(function(x){return x.card_id===id;}).sort(function(a,b){return b.bill_date.localeCompare(a.bill_date);}),
          feeRules:db.fee_rules.filter(function(x){return x.card_id===id;})});
      }
      if(m==='PUT'){ for(var k in body){ db.cards[idx][k]=body[k]; } save(); return j({success:true}); }
      if(m==='DELETE'){
        db.cards.splice(idx,1);
        db.bills=db.bills.filter(function(x){return x.card_id!==id;});
        db.fee_rules=db.fee_rules.filter(function(x){return x.card_id!==id;});
        db.limit_changes=db.limit_changes.filter(function(x){return x.card_id!==id;});
        save(); return j({success:true});
      }
    }
    // 额度变更
    var m2=p.match(/^\/api\/cards\/(\d+)\/limit-change$/);
    if(m2&&m==='POST'){
      var cid=Number(m2[1]), card=null;
      for(var i2=0;i2<db.cards.length;i2++){ if(db.cards[i2].id===cid){ card=db.cards[i2]; break; } }
      if(card){
        var oldLim=num(card.card_limit), newLim=num(body.new_limit!==undefined?body.new_limit:oldLim);
        db.limit_changes.push({id:nextId(db.limit_changes),card_id:cid,old_limit:oldLim,new_limit:newLim,
          change_type:body.change_type||'permanent',effective_date:body.effective_date||today(),
          reason:body.reason||'',created_at:today()+' 00:00:00'});
        card.card_limit=newLim;
        if(body.change_type==='temporary'&&body.new_temp_limit!==undefined){ card.temp_limit=num(body.new_temp_limit); }
        save();
      }
      return j({success:true});
    }
    // 标记本期已还 / 取消
    var m3=p.match(/^\/api\/cards\/(\d+)\/paid$/);
    if(m3){
      var cid3=Number(m3[1]);
      if(m==='POST'){ for(var i3=0;i3<db.cards.length;i3++){ if(db.cards[i3].id===cid3){ db.cards[i3].paid_through=String(body.paid_through||''); break; } } save(); return j({success:true}); }
      if(m==='DELETE'){ for(var i4=0;i4<db.cards.length;i4++){ if(db.cards[i4].id===cid3){ db.cards[i4].paid_through=''; break; } } save(); return j({success:true}); }
    }
    // 账单
    if(p==='/api/bills'&&m==='GET'){ return j({success:true,bills:db.bills}); }
    if(p==='/api/bills'&&m==='POST'){ var b=body; b.id=nextId(db.bills); db.bills.push(b); save(); return j({success:true}); }
    var m4=p.match(/^\/api\/bills\/(\d+)$/);
    if(m4){
      var bid=Number(m4[1]), bi=-1;
      for(var i5=0;i5<db.bills.length;i5++){ if(db.bills[i5].id===bid){ bi=i5; break; } }
      if(m==='PUT'){ for(var k2 in body){ db.bills[bi][k2]=body[k2]; } save(); return j({success:true}); }
      if(m==='DELETE'){ if(bi>=0){ db.bills.splice(bi,1); } save(); return j({success:true}); }
    }
    // 年费规则
    if(p==='/api/fee'&&m==='GET'){ return j({success:true,feeRules:db.fee_rules}); }
    if(p==='/api/fee'&&m==='POST'){ var f=body; f.id=nextId(db.fee_rules); db.fee_rules.push(f); save(); return j({success:true}); }
    var m5=p.match(/^\/api\/fee\/(\d+)$/);
    if(m5){
      var fid=Number(m5[1]), fi=-1;
      for(var i6=0;i6<db.fee_rules.length;i6++){ if(db.fee_rules[i6].id===fid){ fi=i6; break; } }
      if(m==='PUT'){ for(var k3 in body){ db.fee_rules[fi][k3]=body[k3]; } save(); return j({success:true}); }
      if(m==='DELETE'){ if(fi>=0){ db.fee_rules.splice(fi,1); } save(); return j({success:true}); }
    }
    // 设置
    if(p==='/api/settings'&&m==='GET'){ var s={}; for(var k4 in db.settings){ s[k4]=db.settings[k4]; } return j({success:true,settings:s}); }
    if(p==='/api/settings'&&m==='PUT'){ for(var k5 in body){ db.settings[k5]=String(body[k5]); } save(); return j({success:true,message:'设置已保存'}); }
    // 两步验证（演示环境仅模拟流程）
    if(p==='/api/totp/status'&&m==='GET'){ return j({success:true,enabled:false}); }
    if(p==='/api/totp/setup'&&m==='POST'){ return j({success:true,secret:'DEMOSECRETDEMOSECRET',recovery_codes:['1111-2222','3333-4444','5555-6666']}); }
    if(p==='/api/totp/enable'&&m==='POST'){ return j({success:true,message:'演示环境：不实际启用 2FA'}); }
    if(p==='/api/totp/disable'&&m==='POST'){ return j({success:true}); }
    // 导出 / 导入
    if(p==='/api/export/json'&&m==='GET'){
      return new Response(JSON.stringify({exported_at:today(),cards:db.cards,limit_changes:db.limit_changes,bills:db.bills,fee_rules:db.fee_rules,
        settings:Object.keys(db.settings).map(function(k){return {key:k,value:db.settings[k]};})},null,2),
        {headers:{'Content-Type':'application/json;charset=utf-8'}});
    }
    if(p==='/api/export/csv'&&m==='GET'){
      var hdr=['ID','银行','卡种','尾号','状态','永久额度','临时额度','临时额度到期日','账单日','还款类型','还款值','宽限期','最长免息期','年费','年费周期起始','年费周期结束','已用额度','备注'];
      var rows=[hdr.join(',')];
      db.cards.forEach(function(c){ rows.push([c.id,c.bank_name,c.card_type,c.last_4_digits,c.status,c.card_limit,c.temp_limit,c.temp_limit_expiry,c.billing_day,c.payment_type,c.payment_value,c.grace_days,c.max_grace_period,c.annual_fee,c.annual_fee_start,c.annual_fee_end,c.used_amount,c.notes||''].join(',')); });
      return new Response('\uFEFF'+rows.join('\r\n'),{headers:{'Content-Type':'text/csv;charset=utf-8'}});
    }
    if(p==='/api/import'&&m==='POST'){
      if(body.cards){ db.cards=body.cards||[]; db.bills=body.bills||[]; db.fee_rules=body.fee_rules||[]; db.limit_changes=body.limit_changes||[];
        if(body.settings){ db.settings={}; body.settings.forEach(function(x){ db.settings[x.key]=x.value; }); }
        save(); }
      return j({success:true,message:'导入完成'});
    }
    if(p==='/api/cards/import'&&m==='POST'){ return j({success:true,inserted:0,skipped:0,errors:['演示环境：批量导入请在正式版使用']}); }
    if(p==='/api/test-push'&&m==='POST'){ return j({ok:true,message:'演示环境：无需真实推送'}); }
    return j({success:false,message:'Not Found'},404);
  }

  var orig=window.fetch;
  window.fetch=function(url,init){
    if(typeof url==='string' && url.indexOf('/api/')===0) return mock(url,init);
    return orig.apply(this,arguments);
  };
  // 免登录进入
  try{ sessionStorage.setItem('ccToken','demo-token'); sessionStorage.setItem('ccUser','演示用户'); }catch(e){}
  // 演示标识
  document.addEventListener('DOMContentLoaded',function(){
    document.title='卡账记 · 演示站';
    var sub=document.querySelector('.header .sub');
    if(sub) sub.textContent='演示站 · 数据仅存本浏览器';
    var pill=document.createElement('span');
    pill.textContent='演示';
    pill.style.cssText='font-size:10px;font-weight:800;color:#fff;background:linear-gradient(135deg,#10b981,#059669);border-radius:99px;padding:2px 8px;margin-left:8px;letter-spacing:0.5px';
    var title=document.querySelector('.header .title');
    if(title) title.appendChild(pill);
  });
})();
</script>
'''

# 注入：放在 </head> 之前
html = html.replace('</head>', mock + '\n</head>', 1)

import os
os.makedirs('E:/card-ledger/demo', exist_ok=True)
io.open(OUT, 'w', encoding='utf-8').write(html)
print('demo.html 生成:', OUT, len(html), 'bytes')
