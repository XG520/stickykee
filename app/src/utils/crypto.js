// 聊天数据加密（应用层，兼容 http 非安全上下文：WebCrypto 在 http 下不可用，
// 故采用审计过的纯 JS 实现 @noble）：
// 1) ECDH P-256 与服务端协商共享密钥（客户端临时密钥，每次握手轮换）
// 2) HKDF-SHA256 派生 32 字节会话密钥
// 3) AES-256-GCM 密封消息；线包 {"enc":1,"d":"base64(nonce||ciphertext)"}
import { p256 } from '@noble/curves/p256'
import { gcm } from '@noble/ciphers/aes'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { getToken } from '@/api'

const BASE = '/api/v1'
const INFO = new TextEncoder().encode('stickykee-im-v1')

let key = null // Uint8Array(32)
let handshakePromise = null

async function fetchPub() {
  const res = await fetch(BASE + '/crypto/pubkey')
  const p = await res.json().catch(() => null)
  if (!res.ok || !p?.data?.pub) throw new Error('加密公钥获取失败')
  return p.data
}

// handshake 执行一次密钥协商；force=true 强制轮换（服务重启/改密后）。
export async function handshake(force = false) {
  if (key && !force) return
  if (handshakePromise) return handshakePromise
  handshakePromise = doHandshake().finally(() => { handshakePromise = null })
  return handshakePromise
}

async function doHandshake() {
  const info = await fetchPub()
  const priv = p256.utils.randomPrivateKey()
  const clientPub = p256.getPublicKey(priv, false) // 65B 未压缩
  // ECDH：取共享点 x 坐标（32B），再 HKDF
  const shared = p256.getSharedSecret(priv, hexToBytes(info.pub), false).slice(1, 33)
  const derived = hkdf(sha256, shared, undefined, INFO, 32)

  const token = getToken()
  const res = await fetch(BASE + '/crypto/handshake', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ pub: bytesToHex(clientPub) }),
  })
  if (!res.ok) {
    const p = await res.json().catch(() => null)
    throw new Error(p?.error?.message || '加密握手失败')
  }
  key = derived
}

// ready 当前是否已有会话密钥。
export function ready() { return !!key }

function b64(bytes) {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(s)
}
function unb64(s) {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function concat(a, b) {
  const c = new Uint8Array(a.length + b.length)
  c.set(a); c.set(b, a.length)
  return c
}

// sealJSON 把任意可序列化对象密封成线包。
export async function sealJSON(obj) {
  if (!key) await handshake()
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const data = new TextEncoder().encode(JSON.stringify(obj))
  const ct = gcm(key, iv).encrypt(data)
  return { enc: 1, d: b64(concat(iv, ct)) }
}

// openEnvelope 解密封；非密文（明文/已解包）原样返回。
export async function openEnvelope(env) {
  if (!env || env.enc !== 1) return env
  if (!key) await handshake()
  const blob = unb64(env.d)
  const plain = gcm(key, blob.subarray(0, 12)).decrypt(blob.subarray(12))
  return JSON.parse(new TextDecoder().decode(plain))
}

// withCrypto 包裹请求：服务端会话密钥丢失（no_session_key）时
// 自动重新握手并重试一次，其余错误照常抛出。
export async function withCrypto(fn) {
  try {
    return await fn()
  } catch (e) {
    if (e?.code === 'no_session_key') {
      await handshake(true)
      return await fn()
    }
    throw e
  }
}
