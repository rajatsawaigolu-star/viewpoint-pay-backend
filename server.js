import express from "express";
import Razorpay from "razorpay";
import cors from "cors";
import crypto from "crypto";

const app = express();
app.use(cors());
app.use(express.json());

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const payments = new Map();
const tokens = new Map();

app.get("/", (req,res)=> res.send("ViewPoint Backend Running"));

app.post("/create-payment-link", async (req,res)=>{
  try{
    const link = await razorpay.paymentLink.create({
      amount: 2000,
      currency: "INR",
      description: "View Point - One Time Watch 20",
      callback_url: `${process.env.FRONTEND_URL}/verify.html?link_id={payment_link_id}`,
      callback_method: "get"
    });
    payments.set(link.id,{status:"created", consumed:false});
    res.json({id: link.id, url: link.short_url});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post("/webhook", (req,res)=>{
  try{
    const sig = req.headers["x-razorpay-signature"];
    const expected = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(JSON.stringify(req.body)).digest("hex");
    if(sig!==expected) return res.status(400).send("invalid");
    const pl = req.body.payload.payment_link.entity;
    if(req.body.event==="payment_link.paid"){
      payments.set(pl.id,{status:"paid", consumed:false});
    }
    res.json({ok:true});
  }catch(e){ res.json({ok:true}); }
});

app.post("/verify", (req,res)=>{
  const {link_id} = req.body;
  const p = payments.get(link_id);
  if(!p || p.status!=="paid") return res.json({paid:false});
  if(p.consumed) return res.status(410).json({paid:true, error:"Already viewed once"});
  p.consumed = true;
  const token = crypto.randomBytes(16).toString("hex");
  tokens.set(token,{used:false});
  res.json({paid:true, token});
});

app.get("/stream", (req,res)=>{
  const {token} = req.query;
  const t = tokens.get(token);
  if(!t) return res.status(404).send("Invalid link");
  if(t.used) return res.status(410).send("Already watched once - One time only");
  t.used = true;
  res.redirect(process.env.PRIVATE_VIDEO_URL);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log("running"));
