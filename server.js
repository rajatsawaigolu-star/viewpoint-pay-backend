const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

let payments = [];

app.get('/', (req,res)=> res.send('Viewpoint backend is running - UTR System Active'));

app.post('/api/payment/submit', (req,res)=>{
  const { utr } = req.body;
  if(!utr || utr.length < 6) return res.json({success:false, msg:'Invalid UTR'});
  payments.push({utr, amount:20, status:'pending', time:Date.now()});
  res.json({success:true});
});

app.get('/api/payment/check/:utr', (req,res)=>{
  let p = payments.find(x=>x.utr===req.params.utr);
  if(!p) return res.json({status:'not_found'});
  res.json({status:p.status});
});

app.get('/api/admin/payments', (req,res)=> res.json(payments));

app.post('/api/admin/approve', (req,res)=>{
  let p = payments.find(x=>x.utr===req.body.utr);
  if(p) p.status='approved';
  res.json({success:true});
});

app.listen(10000, ()=> console.log('Running'));
