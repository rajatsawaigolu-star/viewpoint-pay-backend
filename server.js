const express = require("express");
const crypto = require("crypto");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json());

// --- Existing Redis Logic (As it is - No change) ---
const memStore = {};
async function redisGet(k){
if(!process.env.UPSTASH_REDIS_REST_URL) return memStore[k]||null; try{ const u=`${process.env.UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(k)}`; const r=await fetch(u,{headers:{Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`}}); const d=await r.json(); return d.result?JSON.parse(d.result):null; }catch{ return memStore[k]||null; } }
async function redisSet(k,v){
if(!process.env.UPSTASH_REDIS_REST_URL){ memStore[k]=v; return; } try{ const u=`${process.env.UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(k)}/${encodeURIComponent(JSON.stringify(v))}`; await fetch(u,{headers:{Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`}}); }catch{ memStore[k]=v; } }
async function redisDel(k){
if(!process.env.UPSTASH_REDIS_REST_URL){ delete memStore[k]; return; } try{ const u=`${process.env.UPSTASH_REDIS_REST_URL}/del/${encodeURIComponent(k)}`; await fetch(u,{headers:{Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`}}); }catch{ delete memStore[k]; } }

// --- NEW: GLF MODULE - TRIAL (Separate, No Razorpay Secret) ---
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

// 1. Health Check
app.get('/', (req,res)=> res.json({ ok:true, project:"viewpoint-pay-backend", glf_module: "active" }));

// 2. Payment Info (Safe)
app.get('/api/payment-info', (req,res)=>{
  res.json({ upiId: UPI_ID, name: "View Point - GLF", note: "Manual Verification Only" });
});

// 3. Submit UTR -> Pending Verification
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
  } catch(e){ res.status(500).json({error:e.message}) }
});

// 4. List All (For Admin)
app.get('/api/assistance/list', async (req,res)=>{
  try{
    if(!supabase) return res.json([]);
    const { data } = await supabase.from('glf_assistance_requests').