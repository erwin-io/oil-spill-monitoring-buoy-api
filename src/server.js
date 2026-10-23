import 'dotenv/config';
import app from './app.js';
const port=Number(process.env.PORT ?? 3000);
app.listen(port,()=>console.log(`Oil Spill Monitoring Buoy API listening at http://localhost:${port}`));
