import express from 'express';
import cors from 'cors';
import collectionRoute from './routes/collections.js';
import linkRoute from './routes/links.js';
import './bot/bot.js';

const app = express();

// Allowed origins: local dev + your future Vercel frontend URL
const allowedOrigins = [
  "http://localhost:5173",
  process.env.FRONTEND_URL
].filter(Boolean);          // removes undefined if env var isn't set

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, Postman, Chrome Extension)
    if (!origin || allowedOrigins.includes(origin) || origin.startsWith("chrome-extension://")) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked: ${origin}`));
    }
  }
}));

app.use(express.json());
app.use('/collections', collectionRoute);
app.use('/links', linkRoute);

app.get("/", (req, res) => {
  res.send("API is running 🚀");
});

const PORT = process.env.PORT || 5000;   // Render sets PORT automatically
app.listen(PORT, () => {
  console.log('[server]', `Server running on port ${PORT}`);
});
