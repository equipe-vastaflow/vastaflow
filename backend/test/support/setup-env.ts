/**
 * Ambiente dos testes e2e (`setupFiles` do Jest, roda antes de qualquer import).
 *
 * `process.env` tem precedencia sobre o `.env` do desenvolvedor, entao estes
 * valores garantem testes reprodutiveis em qualquer maquina.
 */
process.env.NODE_ENV = 'test';
process.env.APP_NAME = 'vasta-flow';
process.env.SWAGGER_ENABLED = 'false';

process.env.JWT_SECRET = 'segredo-e2e-com-mais-de-trinta-e-dois-caracteres';
process.env.JWT_EXPIRES_IN = '1h';
// Custo minimo do bcrypt: os testes criam muitos usuarios e nao medem seguranca do hash.
process.env.BCRYPT_SALT_ROUNDS = '4';

// Exigidos pela validacao de ambiente; o DatabaseModule e trocado por SQLite em
// memoria nos testes, entao estes valores nunca sao usados para conectar.
process.env.DATABASE_TYPE = 'mysql';
process.env.DATABASE_HOST = 'nao-usado';
process.env.DATABASE_NAME = 'nao-usado';
process.env.DATABASE_USER = 'nao-usado';
process.env.DATABASE_PASSWORD = 'nao-usado';
process.env.DATABASE_URL = '';

process.env.SEED_ADMIN_EMAIL = 'admin@vasta.test';
process.env.SEED_ADMIN_PASSWORD = 'AdminSenha1';
process.env.SEED_ADMIN_NAME = 'Admin de Teste';
process.env.FRONTEND_ORIGIN = '';
