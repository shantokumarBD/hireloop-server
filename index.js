import "dotenv/config";
import { client } from "./src/config/db.js";
import app from "./src/app.js";

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`Hireloop server listening on port ${port}`);
});
