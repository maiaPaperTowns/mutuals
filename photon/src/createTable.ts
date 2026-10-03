// One-time setup: `npm run db:create` creates the DynamoDB users table (on-demand billing, free tier friendly).
import { CreateTableCommand, DescribeTableCommand, DynamoDBClient, waitUntilTableExists } from "@aws-sdk/client-dynamodb";

const table = process.env.DYNAMODB_TABLE || "mutual-users";
const db = new DynamoDBClient({});
try {
  await db.send(new DescribeTableCommand({ TableName: table }));
  console.log(`table "${table}" already exists`);
} catch {
  await db.send(
    new CreateTableCommand({
      TableName: table,
      AttributeDefinitions: [{ AttributeName: "userId", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  await waitUntilTableExists({ client: db, maxWaitTime: 60 }, { TableName: table });
  console.log(`created table "${table}" in ${await db.config.region()}`);
}
