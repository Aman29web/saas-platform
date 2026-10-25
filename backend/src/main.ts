import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";

async function bootstrap() {
  // rawBody: true preserves the exact bytes Stripe signed (as req.rawBody)
  // alongside the normal parsed req.body — required for webhook signature
  // verification, which fails on a re-serialized JSON body that doesn't
  // byte-for-byte match what Stripe sent.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.WEB_APP_URL ?? "http://localhost:5173",
    credentials: true,
  });
  app.setGlobalPrefix("api");

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
}

bootstrap();
