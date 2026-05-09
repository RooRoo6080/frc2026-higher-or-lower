import express from "express";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import path from "path";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());

  // TBA API Proxy using the backend environment variable
  app.get("/api/tba/team/:teamNumber/media/:year", async (req, res) => {
    try {
      const { teamNumber, year } = req.params;
      const tbaKey = process.env.TBA_API_KEY;
      if (!tbaKey) return res.status(500).json({ error: "TBA_API_KEY is not configured" });

      const response = await fetch(`https://www.thebluealliance.com/api/v3/team/frc${teamNumber}/media/${year}`, {
        headers: { "X-TBA-Auth-Key": tbaKey }
      });
      if (!response.ok) return res.status(response.status).json({ error: "Failed to fetch from TBA" });
      const data = await response.json();
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/tba/team/:teamNumber/blue-banners", async (req, res) => {
    try {
      const { teamNumber } = req.params;
      const tbaKey = process.env.TBA_API_KEY;
      if (!tbaKey) return res.status(500).json({ error: "TBA_API_KEY is not configured" });

      const response = await fetch(`https://www.thebluealliance.com/api/v3/team/frc${teamNumber}/awards`, {
        headers: { "X-TBA-Auth-Key": tbaKey }
      });
      if (!response.ok) return res.status(response.status).json({ error: "Failed to fetch awards from TBA" });
      const data = await response.json();
      
      const BLUE_BANNER_AWARDS = [0, 1, 3, 69, 74, 80];
      const banners = data.filter((award: any) => BLUE_BANNER_AWARDS.includes(award.award_type));
      res.json({ count: banners.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve the built dist directory
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
