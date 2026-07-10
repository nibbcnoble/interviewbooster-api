// routes/grading.js
const express = require("express");
const router = express.Router();
const { callGradingService } = require('../services/gradingService');

/*
const GRADING_SERVICE_URL = process.env.GRADING_SERVICE_URL || "http://localhost:8000";

router.post("/grade", async (req, res) => {
  const { question, answer } = req.body;
  if (!question || !answer) {
    return res.status(400).json({ error: "question and answer are required" });
  }

  try {
    const response = await fetch(`${GRADING_SERVICE_URL}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, answer }),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Grading service error:", err);
    res.status(502).json({ error: "Grading service unavailable" });
  }
});
*/
router.post('/grade', async (req, res) => {
  try {
    const result = await callGradingService(req.body);
    res.json(result);
  } catch (err) {
    console.error('Grading service call failed:', err.message);
    res.status(502).json({ error: 'Grading service unavailable' });
  }
});

module.exports = router;