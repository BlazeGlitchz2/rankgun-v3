// Rank relay — calls Open Cloud on your behalf
// Usage: npm install express axios && node server.js

import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// Put your Open Cloud key in ENV (safer than hardcoding)
const OC_KEY = process.env.OPEN_CLOUD_KEY;

// (1) Cloud v2 style (role in URL)
async function cloudV2(groupId, userId, roleId) {
  const url = `https://apis.roblox.com/cloud/v2/groups/${groupId}/users/${userId}/roles/${roleId}`;
  return axios.patch(url, {}, { headers: { "x-api-key": OC_KEY } });
}

// (2) Groups v1 style (roleId in body)
async function groupsV1(groupId, userId, roleId) {
  const url = `https://groups.roblox.com/v1/groups/${groupId}/users/${userId}`;
  return axios.patch(url, { roleId }, { headers: { "x-api-key": OC_KEY } });
}

app.post("/promote", async (req, res) => {
  try {
    const { groupId, userId, roleId } = req.body || {};
    if (!OC_KEY)   return res.status(500).json({ ok:false, error:"No OPEN_CLOUD_KEY on server" });
    if (!groupId || !userId || !roleId) return res.status(400).json({ ok:false, error:"Missing fields" });

    // Try Cloud v2 first; fallback to Groups v1
    try {
      const r = await cloudV2(groupId, userId, roleId);
      return res.json({ ok:true, where:"cloudV2", status:r.status });
    } catch (e1) {
      try {
        const r2 = await groupsV1(groupId, userId, roleId);
        return res.json({ ok:true, where:"groupsV1", status:r2.status });
      } catch (e2) {
        const status = e2.response?.status || e1.response?.status || 500;
        const body   = e2.response?.data   || e1.response?.data   || String(e2);
        return res.status(status).json({ ok:false, status, body });
      }
    }
  } catch (err) {
    return res.status(500).json({ ok:false, error:String(err) });
  }
});

app.get("/", (_,res)=>res.send("Rank relay running"));
const port = process.env.PORT || 3000;
app.listen(port, ()=>console.log("Relay listening on", port));
