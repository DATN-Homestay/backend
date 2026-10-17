import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types.js';

import { configureApp } from '../src/app.setup.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../src/modules/auth/auth-token.service.js';
import { UserSession } from '../src/modules/auth/entities/user-session.entity.js';
import { User, UserStatus } from '../src/modules/users/entities/user.entity.js';
import { Role, RoleType } from '../src/modules/users/entities/role.entity.js';

/**
 * E2E cho Auth qua HTTP thật (ValidationPipe, khung response, guard, throttler)
 * nhưng dùng repository trong bộ nhớ để KHÔNG chạm vào DB Aiven dùng chung.
 */

// =========================================================
// REPOSITORY TRONG BỘ NHỚ (đủ cho các truy vấn của AuthService)
// =========================================================

type Row = Record<string, any>;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === 'object' && '_type' in cond) {
      if (cond._type === 'isNull') return value === null || value === undefined;
      if (cond._type === 'in') return (cond._value as unknown[]).includes(value);
    }
    return String(value) === String(cond);
  });
}

class InMemoryRepo {
  rows: Row[] = [];
  private seq = 1;

  constructor(private readonly relations: Record<string, (row: Row) => unknown> = {}) {}

  private withRelations(row: Row, relations?: Row): Row {
    const out = { ...row };
    for (const key of Object.keys(relations ?? {})) {
      if (this.relations[key]) out[key] = this.relations[key](row);
    }
    return out;
  }

  create = (data: Row) => ({ ...data });
  exists = async ({ where }: { where: Row }) => this.rows.some((r) => matches(r, where));
  find = async ({ where }: { where: Row }) => this.rows.filter((r) => matches(r, where));
  findOne = async ({ where, relations }: { where: Row; relations?: Row }) => {
    const row = this.rows.find((r) => matches(r, where));
    return row ? this.withRelations(row, relations) : null;
  };
  save = async (data: Row | Row[]) => {
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      item.id ??= String(this.seq++);
      item.created_at ??= new Date();
      item.revoked_at ??= null;
      item.previous_token_hash ??= null;
      this.rows.push({ status: UserStatus.ACTIVE, failed_login_count: 0, locked_until: null, ...item });
    }
    return data;
  };
  update = async (criteria: string | Row, patch: Row) => {
    const where = typeof criteria === 'string' ? { id: criteria } : criteria;
    const hits = this.rows.filter((r) => matches(r, where));
    hits.forEach((r) => Object.assign(r, patch));
    return { affected: hits.length };
  };
}

// =========================================================
// SETUP
// =========================================================

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let users: InMemoryRepo;

  const http = () => request(app.getHttpServer());
  const account = {
    email: 'Customer@Example.com',
    password: 'SecurePass123',
    full_name: 'Nguyễn Văn A',
    phone_number: '0912345678',
  };
  const login = () =>
    http()
      .post('/api/v1/auth/login')
      .send({ email: 'customer@example.com', password: account.password });

  beforeEach(async () => {
    const roles = new InMemoryRepo();
    await roles.save([
      { id: 1, name: RoleType.CUSTOMER },
      { id: 2, name: RoleType.HOST },
      { id: 3, name: RoleType.ADMIN },
    ]);
    users = new InMemoryRepo();
    const sessions = new InMemoryRepo({
      user: (s) => users.rows.find((u) => u.id === s.user_id),
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
        JwtModule.register({ secret: 'e2e-secret-0123456789abcdef0123456789abcdef' }),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        AuthTokenService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: ConfigService, useValue: { get: (_k: string, fallback?: string) => fallback } },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(Role), useValue: roles },
        { provide: getRepositoryToken(UserSession), useValue: sessions },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // =========================================================
  // ĐĂNG KÝ
  // =========================================================

  it('POST /auth/register → 201 với khung { statusCode, message, data }', async () => {
    const res = await http().post('/api/v1/auth/register').send(account).expect(201);

    expect(res.body).toEqual({
      statusCode: 201,
      message: 'Đăng ký tài khoản thành công',
      data: {
        user_id: '1',
        email: 'customer@example.com', // đã chuẩn hóa chữ thường
        full_name: 'Nguyễn Văn A',
        roles: ['CUSTOMER'],
      },
    });
  });

  it('POST /auth/register với role ADMIN → 400, không tạo tài khoản', async () => {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ ...account, role: 'ADMIN' })
      .expect(400);

    expect(res.body.message).toContain('Vai trò chỉ được là CUSTOMER hoặc HOST');
    expect(users.rows).toHaveLength(0);
  });

  it('POST /auth/register với trường lạ → 400 (forbidNonWhitelisted)', async () => {
    await http()
      .post('/api/v1/auth/register')
      .send({ ...account, is_admin: true })
      .expect(400);
  });

  it('POST /auth/register với mật khẩu yếu → 400', async () => {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ ...account, password: 'password' })
      .expect(400);

    expect(res.body.message).toContain('Mật khẩu phải có chữ hoa, chữ thường và chữ số');
  });

  it('POST /auth/register trùng email → 409', async () => {
    await http().post('/api/v1/auth/register').send(account).expect(201);
    await http()
      .post('/api/v1/auth/register')
      .send({ ...account, phone_number: '0987654321' })
      .expect(409);
  });

  // =========================================================
  // ĐĂNG NHẬP, ME, REFRESH, LOGOUT
  // =========================================================

  describe('khi đã có tài khoản', () => {
    beforeEach(async () => {
      await http().post('/api/v1/auth/register').send(account).expect(201);
    });

    it('login → me trả hồ sơ, không lộ password_hash', async () => {
      const { body } = await login().expect(200);
      expect(body.data.token_type).toBe('Bearer');

      const me = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${body.data.access_token}`)
        .expect(200);

      expect(me.body.data.email).toBe('customer@example.com');
      expect(me.body.data).not.toHaveProperty('password_hash');
    });

    it('GET /auth/me không có token → 401', async () => {
      const res = await http().get('/api/v1/auth/me').expect(401);
      expect(res.body.statusCode).toBe(401);
    });

    it('refresh xoay vòng; dùng lại token cũ thì thu hồi luôn token mới', async () => {
      const { body: loginBody } = await login().expect(200);
      const oldRefresh = loginBody.data.refresh_token;

      const { body: refreshed } = await http()
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: oldRefresh })
        .expect(200);
      const newRefresh = refreshed.data.refresh_token;
      expect(newRefresh).not.toBe(oldRefresh);

      // Kẻ gian dùng lại token cũ → phiên bị thu hồi
      await http().post('/api/v1/auth/refresh').send({ refresh_token: oldRefresh }).expect(401);
      await http().post('/api/v1/auth/refresh').send({ refresh_token: newRefresh }).expect(401);
      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${refreshed.data.access_token}`)
        .expect(401);
    });

    it('logout → access token cũ bị chặn ngay, không phải chờ hết hạn', async () => {
      const { body } = await login().expect(200);
      const auth = `Bearer ${body.data.access_token}`;

      await http().post('/api/v1/auth/logout').set('Authorization', auth).expect(200);
      await http().get('/api/v1/auth/me').set('Authorization', auth).expect(401);
    });

    it('login quá 5 lần/phút từ 1 IP → 429', async () => {
      for (let i = 0; i < 5; i++) {
        await http()
          .post('/api/v1/auth/login')
          .send({ email: 'customer@example.com', password: 'WrongPass1' })
          .expect(401);
      }
      await login().expect(429);
    });

    it('sai mật khẩu 5 lần liên tiếp → đặt locked_until cho tài khoản', async () => {
      for (let i = 0; i < 5; i++) {
        await http()
          .post('/api/v1/auth/login')
          .send({ email: 'customer@example.com', password: 'WrongPass1' })
          .expect(401);
      }

      expect(users.rows[0].locked_until).toBeInstanceOf(Date);
      expect(users.rows[0].locked_until.getTime()).toBeGreaterThan(Date.now());
    });
  });
});
