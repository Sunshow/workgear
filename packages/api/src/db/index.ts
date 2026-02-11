import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema.js'

const connectionString = process.env.DATABASE_URL || 'postgresql://workgear:workgear_dev_pass@localhost:5432/workgear_dev'

const client = postgres(connectionString)
export { client }
export const db = drizzle({ client, schema })
