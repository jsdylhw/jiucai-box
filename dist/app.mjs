import {create, advance, metrics, weights, summary} from './engine.mjs';
import {scenarioCatalog, randomScenario, makeScenario} from './scenarios.mjs';
import {technicalIndicators} from './indicators.mjs';
import {createHoldInspector} from './inspection.mjs';

const $ = id => document.getElementById(id);
const money = n => n.toLocaleString('en-US', {style:'currency', currency:'USD', maximumFractionDigits:2});
const pct = n => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const fixed = n => n == null ? '—' : n.toFixed(2);
const compact = n => n == null ? '—' : n >= 1e6 ? `${(n/1e6).toFixed(2)}M` : `${(n/1e3).toFixed(1)}K`;
const relativeDay = n => n < 0 ? `前 ${-n} 日` : n === 0 ? '起点' : `第 ${n} 天`;
const colors = {up:'#6ed5b3', down:'#f08f91', gold:'#dbc69a', blue:'#7baeee', purple:'#b898e2'};
let source, data, state, ticket, pending=null, chartBars=[], visibleStart=0, indicators, hover=null, resetArmed=false;
let pinned=false;
const holdInspectors=[];

function tell(text, error=false) { $('notice').textContent=text; $('notice').classList.toggle('error',error); }
function startGame() {
  ticket=randomScenario(source,ticket);data=makeScenario(source,ticket);state=create(data);
  pending=null;hover=null;setInput(0);
}
function inputWeight() { return Number($('target-weight').value)/100; }
function targetDescription(value) { return value===0?'全部平仓':`${value>0?'做多':'做空'} ${Math.abs(value*100).toFixed(0)}%`; }
function setInput(value) { $('target-weight').value=value*100; }

function setupCanvas(id) {
  const canvas=$(id), rect=canvas.getBoundingClientRect(), ratio=window.devicePixelRatio||1;
  canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);
  const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.font='10px Segoe UI';
  return {ctx,w:rect.width,h:rect.height};
}
function chartFrame(id,min,max,formatter=fixed) {
  const {ctx,w,h}=setupCanvas(id), left=5,right=Math.max(30,w-57),top=id==='candles'?8:4,bottom=h-(id==='candles'?20:6);
  const pad=(max-min||Math.max(Math.abs(max)*.02,1))*.10, low=min<0?min-pad:Math.max(0,min-pad), high=max+pad;
  const y=value=>bottom-(value-low)/(high-low)*(bottom-top), step=(right-left)/chartBars.length;
  const x=i=>left+(i+.5)*step;
  ctx.strokeStyle='#2a3340';ctx.fillStyle='#8c9aac';
  for(let i=0;i<4;i++) { const value=low+(high-low)*i/3,yy=y(value);ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();ctx.fillText(formatter(value),right+7,yy+3); }
  return {ctx,w,h,left,right,top,bottom,y,x,step};
}
function line(frame,values,color) {
  const {ctx,x,y}=frame;ctx.strokeStyle=color;ctx.lineWidth=1.25;ctx.beginPath();let connected=false;
  values.forEach((v,i)=>{if(v==null){connected=false;return;}if(connected)ctx.lineTo(x(i),y(v));else ctx.moveTo(x(i),y(v));connected=true;});ctx.stroke();ctx.lineWidth=1;
}
function crosshair(frame, close=null) {
  if(hover===null)return;
  const {ctx,x,y,left,right,top,bottom}=frame;ctx.save();ctx.strokeStyle='#bdc9d980';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x(hover),top);ctx.lineTo(x(hover),bottom);
  if(close!==null){ctx.moveTo(left,y(close));ctx.lineTo(right,y(close));}
  ctx.stroke();ctx.setLineDash([]);
  if(close!==null){ctx.fillStyle='#dbc69a';ctx.beginPath();ctx.arc(x(hover),y(close),3,0,Math.PI*2);ctx.fill();ctx.fillRect(right+2,y(close)-9,54,18);ctx.fillStyle='#17202b';ctx.fillText(fixed(close),right+5,y(close)+3);}
  ctx.restore();
}
function windowed(key) { return indicators[key].slice(visibleStart,visibleStart+chartBars.length); }
function drawCandles() {
  const averages=['ma5','ma10','ma20'].flatMap(windowed).filter(v=>v!==null);
  const min=Math.min(...chartBars.map(b=>b.low),...averages), max=Math.max(...chartBars.map(b=>b.high),...averages);
  const f=chartFrame('candles',min,max,v=>v.toFixed(0)), {ctx,x,y,step,h,right}=f;
  chartBars.forEach((b,i)=>{ctx.strokeStyle=ctx.fillStyle=b.close>=b.open?colors.up:colors.down;ctx.beginPath();ctx.moveTo(x(i),y(b.high));ctx.lineTo(x(i),y(b.low));ctx.stroke();ctx.fillRect(x(i)-step*.28,Math.min(y(b.open),y(b.close)),Math.max(1,step*.56),Math.max(1,Math.abs(y(b.open)-y(b.close))));});
  line(f,windowed('ma5'),colors.gold);line(f,windowed('ma10'),colors.blue);line(f,windowed('ma20'),colors.purple);crosshair(f,hover===null?null:chartBars[hover].close);
  ctx.fillStyle='#8c9aac';ctx.fillText(relativeDay(visibleStart-data.startIndex),5,h-2);ctx.fillText(relativeDay(state.day),Math.max(70,right-48),h-2);
}
function drawVolume() {
  const f=chartFrame('volume-chart',0,Math.max(...chartBars.map(b=>b.volume),...['volumeMa5','volumeMa10'].flatMap(windowed).filter(v=>v!=null)),compact);
  const {ctx,x,y,step}=f;
  chartBars.forEach((b,i)=>{ctx.fillStyle=b.close>=b.open?'#6ed5b385':'#f08f9185';ctx.fillRect(x(i)-step*.31,y(b.volume),Math.max(1,step*.62),y(0)-y(b.volume));});
  line(f,windowed('volumeMa5'),colors.gold);line(f,windowed('volumeMa10'),colors.blue);crosshair(f);
}
function drawMacd() {
  const values=['dif','dea','histogram'].flatMap(windowed).filter(v=>v!=null);
  const f=chartFrame('macd-chart',Math.min(0,...values),Math.max(0,...values));
  const {ctx,x,y,step,left,right}=f;ctx.strokeStyle='#657384';ctx.beginPath();ctx.moveTo(left,y(0));ctx.lineTo(right,y(0));ctx.stroke();
  windowed('histogram').forEach((v,i)=>{if(v==null)return;ctx.fillStyle=v>=0?'#6ed5b390':'#f08f9190';ctx.fillRect(x(i)-step*.28,Math.min(y(v),y(0)),Math.max(1,step*.56),Math.max(1,Math.abs(y(v)-y(0))));});
  line(f,windowed('dif'),colors.gold);line(f,windowed('dea'),colors.blue);crosshair(f);
}
function indicatorReadouts() {
  const index=visibleStart+(hover??(chartBars.length-1)), current=data.stocks.ASSET.bars[index];
  const previous=data.stocks.ASSET.bars[index-1], change=previous?(current.close/previous.close-1)*100:null;
  $('price').textContent=money(current.close);
  $('price-change').textContent=change===null?'—':pct(change);$('price-change').className=change===null?'':change>=0?'positive':'negative';
  $('selected-day').textContent=relativeDay(index-data.startIndex);
  $('latest-bar').disabled=hover===null;
  document.querySelector('.ohlc-grid').classList.toggle('inspecting',hover!==null);
  for(const field of ['open','high','low','close']) {
    const cell=$(`${field}-value`);cell.textContent=fixed(current[field]);
    cell.className=!previous?'':current[field]>=previous.close?'positive':'negative';
  }
  $('ma-values').innerHTML=`<span class="ma5">MA5 ${fixed(indicators.ma5[index])}</span><span class="ma10">MA10 ${fixed(indicators.ma10[index])}</span><span class="ma20">MA20 ${fixed(indicators.ma20[index])}</span>`;
  $('volume-values').innerHTML=`VOL ${compact(current.volume)} <span class="ma5">MA5 ${compact(indicators.volumeMa5[index])}</span> <span class="ma10">MA10 ${compact(indicators.volumeMa10[index])}</span>`;
  $('macd-values').innerHTML=`<span class="ma5">DIF ${fixed(indicators.dif[index])}</span><span class="ma10">DEA ${fixed(indicators.dea[index])}</span><span>柱 ${fixed(indicators.histogram[index])}</span>`;
  $('chart-detail').textContent=hover===null?'长按选中 · 左右滑动查看 · 点“最新”返回':`${relativeDay(index-data.startIndex)} · 量 ${current.volume.toLocaleString('en-US')} 股 · 振幅 ${previous?((current.high-current.low)/previous.close*100).toFixed(2)+'%':'—'}${pinned?' · 已选中':''}`;
}
function drawMarket() { if(!indicators)return;drawCandles();drawVolume();drawMacd();indicatorReadouts(); }
function drawEquity() {
  const {ctx,w,h}=setupCanvas('equity-chart'), points=state.history,initial=state.config.initial;
  const values=points.map(p=>p.equity),min=Math.min(initial,...values),max=Math.max(initial,...values),pad=Math.max((max-min)*.15,initial*.002);
  const y=v=>h-18-(v-min+pad)/(max-min+2*pad)*(h-30),x=i=>5+i/Math.max(1,points.length-1)*(w-10);
  ctx.strokeStyle='#536071';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(0,y(initial));ctx.lineTo(w,y(initial));ctx.stroke();ctx.setLineDash([]);
  ctx.strokeStyle=colors.gold;ctx.lineWidth=2;ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(x(i),y(p.equity)):ctx.moveTo(x(i),y(p.equity)));ctx.stroke();
  if(points.length===1){ctx.fillStyle=colors.gold;ctx.beginPath();ctx.arc(x(0),y(initial),3,0,Math.PI*2);ctx.fill();}
  ctx.fillStyle='#8c9aac';ctx.fillText('第 0 天',5,h-1);ctx.fillText(`第 ${state.day} 天`,w-50,h-1);
}
function render() {
  const m=metrics(data,state),result=summary(data,state),end=state.day>=data.sessions||state.bankrupt;
  $('date').textContent=end?'本次盲测已结束':state.day===0?'开始前 · 收盘观察':`第 ${state.day} 天 · 收盘`;
  $('day').textContent=String(state.day).padStart(2,'0');$('progress').style.width=`${state.day/data.sessions*100}%`;
  $('equity').textContent=money(m.equity);$('initial').textContent=`初始资金 ${money(state.config.initial)}`;
  $('return').textContent=pct(result.returnPct);$('return').className=result.returnPct>=0?'positive':'negative';
  $('drawdown').textContent=`${result.maxDrawdownPct.toFixed(2)}%`;$('exposure').textContent=m.equity>0?`${(m.gross/m.equity*100).toFixed(1)}%`:'—';
  $('costs').textContent=`佣金 ${money(state.fees)} / 借券 ${money(state.borrowPaid)}`;$('cash').textContent=money(state.cash);
  const held=state.positions.ASSET;
  $('holding').textContent=held?`${held>0?'多头':'空头'} ${Math.abs(held)} 股`:'空仓';$('holding').className=held<0?'negative':held>0?'positive':'';
  $('position-weight').textContent=m.equity>0?`当前仓位 ${pct(m.net/m.equity*100)}`:'当前仓位 —';
  $('pending-text').textContent=end?'本局已结束 · 可随机开始新一局':pending?`已提交：${targetDescription(pending.ASSET)} · 下一开盘执行`:'点仓位按钮下单；直接推进则保持持仓';
  $('cancel').hidden=!pending;for(const id of ['next','finish','submit','cancel','target-weight'])$(id).disabled=end;
  document.querySelectorAll('[data-preset]').forEach(button=>{button.disabled=end;const target=button.dataset.preset==='flat'?0:Number(button.dataset.preset.replace('long','').replace('short',''))/100*(button.dataset.preset.startsWith('short')?-1:1);button.setAttribute('aria-pressed',String(pending!==null&&pending.ASSET===target));});
  $('trade-count').textContent=`${state.fills.length} 笔成交`;
  $('trades').innerHTML=state.fills.length?state.fills.toReversed().map(f=>`<tr><td>第 ${f.day} 天</td><td>匿名股票</td><td class="${f.delta>0?'positive':'negative'}">${f.delta>0?'买入 / 回补':'卖出 / 做空'} · ${f.reason}</td><td>${Math.abs(f.delta)}</td><td>${money(f.price)}</td><td>${money(f.fee)}</td></tr>`).join(''):'<tr><td colspan="6" class="empty">尚无成交。设置目标仓位，提交后推进一天。</td></tr>';
  $('result').hidden=!end;$('result-text').textContent=`${state.bankrupt?'账户已触发负资产终止。':''}期末净资产 ${money(m.equity)}，收益 ${pct(result.returnPct)}，最大回撤 ${result.maxDrawdownPct.toFixed(2)}%。净分红 ${money(state.dividends)}。${state.marginCall?'期末存在保证金缺口，尚未执行后续开盘平仓。':''}`;
  const endIndex=data.startIndex+state.day;
  visibleStart=Math.max(0,endIndex-69);chartBars=data.stocks.ASSET.bars.slice(visibleStart,endIndex+1);
  indicators=technicalIndicators(data.stocks.ASSET.bars.slice(0,endIndex+1));
  hover=null;pinned=false;holdInspectors.forEach(controller=>controller.cancel());$('visible-range').textContent=`当前显示 ${chartBars.length} 根日线 · 无未来数据`;
  drawMarket();drawEquity();
}
function step(finish=false) {
  try {
    const queued=pending!==null;state=advance(data,state,pending);pending=null;
    if(finish)while(state.day<data.sessions&&!state.bankrupt)state=advance(data,state);
    render();
    tell(state.day===60?'60 个交易日已完成，结果已生成。':state.bankrupt?'本局因负资产终止。':state.marginCall?'收盘已触发实验保证金条件，将在下一开盘优先平仓。':queued?'目标仓位已在新交易日开盘执行。':'已推进一日，保留原有股数。');
  } catch(error) { tell(error.message,true); }
}

async function init() {
  try {
    const response=await fetch('./data/us-2025.json');if(!response.ok)throw new Error('未找到行情文件，请先运行 scripts/fetch_data.py。');source=await response.json();
    startGame();render();
    const count=scenarioCatalog(source).length;
    $('data-info').textContent=`当前样本包含 ${source.tradable.length} 只美股、${count} 个可抽取的股票与起点组合。每局随机选择一个组合，保证至少 60 根前置日线及随后 60 个完整交易日；新开局不会重复上一局的完全相同组合。`;
    tell('随机场景已就绪。先观察量价与指标，再设置你的第一笔仓位。');
    $('submit').onclick=()=>{try{pending=weights(data,{ASSET:inputWeight()});render();tell('订单已提交，可在推进前撤销或重新提交。');}catch(error){tell(error.message,true);}};
    $('cancel').onclick=()=>{pending=null;render();tell('待执行订单已撤销。');};
    $('next').onclick=()=>step();$('finish').onclick=()=>step(true);
    const presets={long25:.25,long50:.5,long100:1,short25:-.25,short50:-.5,short100:-1,flat:0};
    document.querySelectorAll('[data-preset]').forEach(button=>button.onclick=()=>{setInput(presets[button.dataset.preset]);$('submit').click();});
    $('reset').onclick=()=>{
      if(!resetArmed){resetArmed=true;$('reset').textContent='确认随机新开局';tell('再次点击确认，将随机抽取股票和起点并重置资金。');return;}
      startGame();resetArmed=false;$('reset').textContent='↻ 随机新开一局';render();tell('新的匿名场景已抽取，资金已重置。');
    };
    new ResizeObserver(()=>{drawMarket();drawEquity();}).observe($('candles').parentElement);
    const releaseSelection=()=>{holdInspectors.forEach(controller=>controller.cancel());pinned=false;hover=null;drawMarket();};
    $('latest-bar').onclick=releaseSelection;
    for(const id of ['candles','volume-chart','macd-chart']) {
      const canvas=$(id);
      const selectAt=(clientX,lock=false)=>{const rect=canvas.getBoundingClientRect();hover=Math.max(0,Math.min(chartBars.length-1,Math.floor((clientX-rect.left-5)/(rect.width-62)*chartBars.length)));if(lock)pinned=true;drawMarket();};
      const hold=createHoldInspector({select:x=>selectAt(x,true)});holdInspectors.push(hold);
      canvas.addEventListener('touchstart',event=>{if(event.touches.length!==1){hold.cancel();return;}const touch=event.touches[0];hold.start(touch.clientX,touch.clientY);},{passive:true});
      canvas.addEventListener('touchmove',event=>{if(event.touches.length!==1){hold.cancel();return;}const touch=event.touches[0];if(hold.move(touch.clientX,touch.clientY)&&event.cancelable)event.preventDefault();},{passive:false});
      canvas.addEventListener('touchend',event=>{if(hold.end()&&event.cancelable)event.preventDefault();},{passive:false});
      canvas.addEventListener('touchcancel',()=>hold.cancel());
      canvas.oncontextmenu=event=>event.preventDefault();
      canvas.onpointermove=event=>{if(event.pointerType==='touch')return;if(!pinned||event.buttons===1)selectAt(event.clientX,event.buttons===1);};
      canvas.onpointerdown=event=>{if(event.pointerType!=='touch')selectAt(event.clientX,true);};
      canvas.onpointerleave=()=>{if(!pinned){hover=null;drawMarket();}};
      canvas.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();releaseSelection();return;}if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();pinned=true;hover=event.key==='Home'?0:event.key==='End'?chartBars.length-1:Math.max(0,Math.min(chartBars.length-1,(hover??chartBars.length-1)+(event.key==='ArrowLeft'?-1:1)));drawMarket();};
      canvas.onblur=()=>{if(!pinned){hover=null;drawMarket();}};
    }
    document.addEventListener('visibilitychange',()=>{if(document.hidden)holdInspectors.forEach(controller=>controller.cancel());});
  } catch(error) { tell(error.message,true); }
}
init();
