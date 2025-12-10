declare module '@aws-sdk/s3-request-presigner' {
  import type { RequestPresigningArguments } from '@aws-sdk/types';
  import type { HttpRequest } from '@aws-sdk/protocol-http';
  import type { S3Client } from '@aws-sdk/client-s3';

  export function getSignedUrl(
    client: S3Client,
    command: { input: unknown },
    options?: RequestPresigningArguments & { expiresIn?: number }
  ): Promise<string>;

  export function createRequest(
    command: { input: unknown },
    client: S3Client
  ): Promise<HttpRequest>;
}

