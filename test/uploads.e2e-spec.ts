import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Uploads & Profile Photo Workflow (e2e)', () => {
  let app: INestApplication<App>;
  let user: any;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    const ts = Date.now();
    const email = `photo_user_${ts}@test.com`;
    const password = 'Password123!';

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email,
        password,
        name: 'Photo Test User',
        role: 'SPECIALIST',
      });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });

    token = loginRes.body.accessToken;
    user = loginRes.body.user;
  });

  afterAll(async () => {
    await app.close();
  });

  it('Upload JPEG profile picture', async () => {
    const jpgBuffer = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
    const res = await request(app.getHttpServer())
      .post('/uploads')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', jpgBuffer, 'avatar.jpg')
      .expect(201);

    expect(res.body).toHaveProperty('url');
    expect(res.body.url).toMatch(/^data:image\/jpeg;base64,/);

    // Update profile
    const patchRes = await request(app.getHttpServer())
      .patch('/profiles/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ avatarUrl: res.body.url })
      .expect(200);

    expect(patchRes.body.avatarUrl).toBe(res.body.url);
  });

  it('Upload PNG profile picture', async () => {
    const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const res = await request(app.getHttpServer())
      .post('/uploads')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', pngBuffer, 'avatar.png')
      .expect(201);

    expect(res.body).toHaveProperty('url');
    expect(res.body.url).toMatch(/^data:image\/png;base64,/);
  });

  it('Upload WebP profile picture', async () => {
    const webpBuffer = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
    const res = await request(app.getHttpServer())
      .post('/uploads')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', webpBuffer, 'avatar.webp')
      .expect(201);

    expect(res.body).toHaveProperty('url');
    expect(res.body.url).toMatch(/^data:image\/webp;base64,/);
  });

  it('Reject invalid file extension', async () => {
    const txtBuffer = Buffer.from('plain text file');
    await request(app.getHttpServer())
      .post('/uploads')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', txtBuffer, 'malicious.exe')
      .expect(400);
  });
});
