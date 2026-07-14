// routes/grading.js
const express = require("express");
const router = express.Router();

const BEATLES_FASTAPI_URL = process.env.BEATLES_FASTAPI_URL || "http://127.0.0.1:8000/interview";

/*
Expected request body:
{
  "beatle": "john",
  "question": "What was the mood in the studio during those sessions?"
}
*/



router.post("/beatles/interview", async (req, res) => {
  try {
    const { beatle, question } = req.body;

    // Basic validation
    if (!beatle || !question) {
      return res.status(400).json({
        error: "Missing required fields: beatle and question"
      });
    }

    const fastApiResponse = await fetch(`${BEATLES_FASTAPI_URL}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        beatle,
        question
      })
    });

    const data = await fastApiResponse.json();

    if (!fastApiResponse.ok) {
      return res.status(fastApiResponse.status).json({
        error: "FastAPI request failed",
        details: data
      });
    }

    return res.json(data);
  } catch (error) {
    console.error("Error calling FastAPI /interview:", error);

    return res.status(500).json({
      error: "Internal server error",
      details: error.message
    });
  }
});

module.exports = router;
