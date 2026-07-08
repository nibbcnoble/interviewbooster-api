const express = require('express');
require('dotenv').config();

const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080; // App Service injects PORT

/*
app.use(cors({
  origin: 'https://wonderful-wave-025108c1e.7.azurestaticapps.net'
}));
*/
app.use(cors()); 
app.use(express.json());

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Communication verified. Application API is accessible.' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const gradingRoutes = require("./routes/grading");
app.use("/api", gradingRoutes);

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});

