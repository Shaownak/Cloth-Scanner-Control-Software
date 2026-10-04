import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { credentials } from '../working-software/src/credentials.js';
const directory=process.env.DATA_DIR || fileURLToPath(new URL('../working-software/data',import.meta.url));
const keys=credentials(directory);
console.log(`Access keys in ${path.join(directory,'credentials.json')}\nKeep these private.\n\nOperator key (dashboard):\n${keys.operator_token}\n\nDevice key (ESP32 table_config.h):\n${keys.device_token}\n\nVision key (integration API):\n${keys.vision_token}`);
