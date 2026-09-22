const express = require("express");
const crypto = require("crypto");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json());

// --- Existing Redis Logic (As it is - No change - Meeru ichina logic same) ---
const memStore = {};
async function redisGet(k){
if(!process.env.UPSTASH_REDIS_REST_URL) return memStore[k]||null; try{ const u=`${process.env.UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(k)}`; const r=await fetch(u,{headers:{Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`}}); const d=await r.json(); return d.result?JSON.parse(d.result):null; }catch{ return memStore[k]||null; } }
async function redisSet(k,v){
if(!process.env.UPSTASH_REDIS_REST_URL){ memStore[k]=v; return; } try{ const u=`${process.env.UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(k)}/${encodeURIComponent(JSON.stringify(v))}`; await fetch(u,{headers:{Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`}}); }catch{ memStore[k]=v; } }
async function redisDel(k){
if(!process.env.UPSTASH_REDIS_REST_URL){ delete memStore[k]; return; } try{ const u=`${process.env.UPSTASH_REDIS_REST_URL}/del/${encodeURIComponent(k)}`; await fetch(u,{headers:{Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`}}); }catch{ delete memStore[k]; } }

// --- Supabase (Mee code same) ---
let supabase = null;
let supabaseAdmin = null;
try {
  const { createClient } = require('@supabase/supabase-js');
  if(process.env.SUPABASE_URL){
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
  }
} catch(e){ console.log("Supabase not configured yet"); }

const UPI_ID = "pgangadhar444-1@oksbi";
const ADMIN_SECRET = process.env.ADMIN_VERIFICATION_SECRET || "change-this-in-env";

// 1. Health Check (Mee code same)
app.get('/', (req,res)=> res.json({ ok:true, project:"viewpoint-pay-backend", glf_module: "active", ledger: "verified-only" }));

// 2. Payment Info (Safe - Mee code same)
app.get('/api/payment-info', (req,res)=>{
  res.json({ upiId: UPI_ID, name: "View Point - GLF", note: "Manual Verification Only" });
});

// 3. Submit UTR -> Pending Verification (Mee code same - preserve)
app.post('/api/assistance/request', async (req,res)=>{
  try{
    if(!supabase) return res.status(500).json({error:'Supabase not connected'});
    const { amount, utr_number, user_name } = req.body;
    if(!utr_number || utr_number.length < 6) return res.status(400).json({error:'Valid UTR kavali'});
    const { data, error } = await supabase.from('glf_assistance_requests').insert([{
      amount: parseInt(amount)||2000,
      utr_number,
      user_name: user_name || 'Trial User',
      payment_method: 'UPI_QR',
      upi_id_used: UPI_ID,
      status: 'Pending Verification'
    }]).select();
    if(error) throw error;
    res.json({ success:true, status:'Pending Verification', data });
  } catch(e){ console.error(e); res.status(500).json({error:'Request failed'}) }
});

// 4. List All (For Admin) - Mee cut ayina part ni complete chesa
app.get('/api/assistance/list', async (req,res)=>{
  try{
    if(!supabase) return res.json([]);
    const { data, error } = await supabase.from('glf_assistance_requests').select('*').order('created_at',{ascending:false});
    if(error) throw error;
    res.json(data||[]);
  }catch(e){ console.error(e); res.status(500).json({error:'List failed'}) }
});

// --- NEW ADDITIONS - Gap ni fill chese verified system - Existing code touch cheyamu ---

// 5. Admin Verification Endpoint - Mee gap ki solution
app.post('/api/assistance/verify', async (req,res)=>{
  try{
    const { request_id, action, admin_secret, verified_amount } = req.body;

    // Admin auth - timingSafeEqual tho
    if(!admin_secret ||!ADMIN_SECRET){
      return res.status(403).json({message:"Admin verification data missing"});
    }
    const a = Buffer.from(admin_secret);
    const b = Buffer.from(ADMIN_SECRET);
    if(a.length!== b.length ||!crypto.timingSafeEqual(a,b)){
      return res.status(403).json({message:"Unauthorized"});
    }
    if(!request_id) return res.status(400).json({message:"Payment verification data missing"});

    if(!supabase) return res.status(500).json({message:"Supabase not configured"});

    // Fetch existing request
    const { data: existing } = await supabase.from('glf_assistance_requests').select('*').eq('id', request_id).single();
    if(!existing) return res.status(404).json({message:"Request not found"});

    // Idempotent - already verified ayite same response
    if(existing.status === 'Verified'){
      return res.json({ verified:true, status:'Verified', message:'Already verified', data: existing });
    }

    let newStatus = 'Pending Verification';
    let amountToVerify = existing.amount;

    if(action === 'verify'){
      newStatus = 'Verified';
      // Production amount DB nundi - frontend amount kaadu
      if(verified_amount) amountToVerify = parseInt(verified_amount);
    } else if(action === 'reject'){
      newStatus = 'Rejected';
    }

    const { data, error } = await supabase.from('glf_assistance_requests').update({
      status: newStatus,
      verified_amount: newStatus==='Verified'? amountToVerify : null,
      verified_at: newStatus==='Verified'? new Date().toISOString() : null
    }).eq('id', request_id).select();

    if(error) throw error;

    // Ledger entry - verified ayinappudu matrame - Fix 5
    if(newStatus === 'Verified'){
      await supabase.from('glf_ledger').insert([{
        request_id: request_id,
        utr_number: existing.utr_number,
        amount: amountToVerify,
        type: 'CREDIT',
        status: 'Verified',
        user_name: existing.user_name
      }]);
    }

    res.json({ verified: newStatus==='Verified', status: newStatus, data });
  }catch(e){
    console.error("Verify error:", e);
    res.status(500).json({message:"Verification error - please try again"});
  }
});

// 6. Balance - Verified transactions aadharanga matrame - Fake display kaadu
app.get('/api/ledger/balance', async (req,res)=>{
  try{
    if(!supabase) return res.json({ balance:0, verified_count:0 });
    // Only verified ledger entries - pending kaadu
    const { data, error } = await supabase.from('glf_ledger').select('amount').eq('status','Verified').eq('type','CREDIT');
    if(error) throw error;
    const balance = (data||[]).reduce((sum,r)=> sum + (parseInt(r.amount)||0), 0);
    res.json({ balance, verified_count: data.length, note:"Balance calculated from verified transactions only" });
  }catch(e){
    console.error(e); res.status(500).json({error:'Balance fetch failed'});
  }
});

// 7. Withdrawal / Payout - Legitimate provider structure - Bank auth create cheyadu
app.post('/api/withdrawal/request', async (req,res)=>{
  try{
    const { amount, destination } = req.body;

    // Provider check - Mee requirement prakaram
    if(!process.env.PAYOUT_PROVIDER_API_KEY ||!process.env.PAYOUT_PROVIDER_URL){
      return res.status(503).json({message:"Payment provider not configured - Payout provider/account must be configured separately through authorized provider"});
    }

    // Check verified balance first
    if(!supabase) return res.status(500).json({message:"Supabase not configured"});
    const { data } = await supabase.from('glf_ledger').select('amount').eq('status','Verified').eq('type','CREDIT');
    const balance = (data||[]).reduce((s,r)=> s + (parseInt(r.amount)||0), 0);
    const debits = await supabase.from('glf_ledger').select('amount').eq('type','DEBIT').eq('status','Verified');
    const debitSum = (debits.data||[]).reduce((s,r)=> s + (parseInt(r.amount)||0), 0);
    const available = balance - debitSum;

    if(parseInt(amount) > available){
      return res.status(400).json({message:`Insufficient verified balance. Available: ${available}`});
    }

    // IMPORTANT: Ee code kottha bank account/payout authorization ni create cheyadu
    // Actual payout - authorized provider API dwara matrame - idhi structure mathrame
    // const payoutResponse = await fetch(process.env.PAYOUT_PROVIDER_URL, { method:'POST', headers:{ Authorization: `Bearer ${process.env.PAYOUT_PROVIDER_API_KEY}` }, body: JSON.stringify({ amount, destination }) });

    // For trial - pending withdrawal record only
    const { data: wd, error } = await supabase.from('glf_ledger').insert([{
      amount: parseInt(amount),
      type: 'DEBIT',
      status: 'Pending Verification',
      user_name: destination || 'Self Withdrawal',
      utr_number: 'WD-'+Date.now()
    }]).select();

    if(error) throw error;
    res.json({ success:true, status:'Pending Verification', message:'Withdrawal request created - will be processed after provider verification', data: wd });

  }catch(e){
    console.error(e); res.status(500).json({message:"Withdrawal failed"});
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`GLF Backend running on ${PORT} - Verified-only ledger active`));