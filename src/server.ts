import express from 'express';
import path from 'path';
import { fetchPairs } from './fetchPairs';

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/pairs', async (req, res) => {
  try {
    const pairs = await fetchPairs();
    res.json({
      success: true,
      data: pairs,
      count: pairs.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
