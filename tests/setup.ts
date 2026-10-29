import { randomBytes } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.PORT = '4001';
process.env.MONGODB_URI = `mongodb://127.0.0.1:27017/moneystrait_test_${randomBytes(4).toString('hex')}`;
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.FRONTEND_ORIGIN = 'http://localhost:3000';
process.env.TRUST_PROXY_HOPS = '0';
