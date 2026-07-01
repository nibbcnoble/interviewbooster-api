const express = require('express');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable JSON parsing middleware (useful for reading request bodies)
app.use(express.json());

// Define a simple test route
app.get('/', (req, res) => {
    res.send('How many assholes we got on this ship anyhow? ... Keep firing assholes');
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is happily listening at http://localhost:${PORT}`);
});