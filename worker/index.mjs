import assets from 'journal:assets';
import { createHandler } from './app.mjs';
export default { fetch: createHandler(assets) };
