import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, nameError, NAME_MIN, NAME_MAX } from '../server/room.mjs';
import { cleanShopName, SHOP_MAX } from '../server/leaderboard.mjs';
import { validEvent } from '../server/protocol.mjs';

test('wire and internal name rules retain their intentionally different normalization', () => {
  assert.equal(NAME_MIN, 2);
  assert.equal(NAME_MAX, 12);
  assert.equal(nameError(' ' + '가'.repeat(12) + ' '), null);
  assert.equal(validEvent('room:create', { name: ' ' + '가'.repeat(12) + ' ' }), false);
  assert.equal(nameError('가'), '이름은 2글자 이상이어야 합니다.');
  assert.equal(nameError('가'.repeat(13)), '이름은 12글자를 넘을 수 없습니다.');
  assert.equal(nameError('가\n나'), '올바른 이름을 입력해 주세요.');
  assert.equal(validEvent('room:create', { name: '가\n나' }), false);
  assert.equal(validEvent('room:create', { name: '  가나  ' }), true);
  const room = new Room('ABCD');
  assert.equal(room.addPlayer('a', ' ' + '가'.repeat(15)).name, '가'.repeat(12));
  assert.equal(room.addPlayer('b', '').name, '알바2');
  assert.equal(room.addPlayer('c', '가\n나').name, '가\n나');
  for (let i = 3; i < 6; i++) assert.ok(room.addPlayer('p' + i, '참가자'));
  assert.equal(room.addPlayer('overflow', '참가자'), null);
  room.removePlayer('b');
  assert.equal(room.addPlayer('reused', '참가자').slot, 1);
});

test('shop display truncation and permissive wire ceiling stay distinct', () => {
  assert.equal(SHOP_MAX, 16);
  assert.equal(cleanShopName(' \n' + '가'.repeat(20) + ' '), '가'.repeat(16));
  assert.equal(cleanShopName('', '기본 가게'), '기본 가게');
  assert.equal(cleanShopName(''), '이름 없는 김밥집');
  assert.equal(validEvent('room:create', { name: '가나', shop: '가'.repeat(64) }), true);
  assert.equal(validEvent('room:create', { name: '가나', shop: '가'.repeat(65) }), false);
  assert.equal(validEvent('room:create', { name: '가나', shop: '\n' }), false);
});

test('room codes retain four case-insensitive nonambiguous letters and outer trim', () => {
  for (const code of ['ABCD', 'abcd', '  ABCD  ', 'HJNP', 'WXYZ'])
    assert.equal(validEvent('room:join', { name: '가나', code }), true, code);
  for (const code of ['ABC', 'ABCDE', 'ABCI', 'ABCO', 'AB12', 'AB C', 'ABÇD'])
    assert.equal(validEvent('room:join', { name: '가나', code }), false, code);
});

test('shared game contract names the existing client/server limits without server secrets', async () => {
  const rules = await import('../public/js/game-rules.js');
  assert.equal(rules.PLAYER_LIMIT, 6);
  assert.equal(rules.NAME_MIN, NAME_MIN);
  assert.equal(rules.NAME_MAX, NAME_MAX);
  assert.equal(rules.SHOP_MAX, SHOP_MAX);
  assert.equal(rules.SHOP_INPUT_MAX, 64);
  assert.equal(rules.ROOM_CODE_LENGTH, 4);
  assert.equal(rules.ROOM_CODE_ALPHABET, 'ABCDEFGHJKLMNPQRSTUVWXYZ');
  assert.equal(rules.DEFAULT_RECOVERY_MS, 30000);
});
