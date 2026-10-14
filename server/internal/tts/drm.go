// Edge TTS v2 DRM：Sec-MS-GEC token 生成。
//
// 2026-10-10 起微软将 Read Aloud 鉴权 token 从 v1（64 位大写 hex）升级为
// v2（"<16位hex>-<64位hex>" 双摘要，CS64 + 变体 SHA-256），旧格式一律 403。
// 算法移植自 rany2/edge-tts PR #492（对 Edge 155 msedge.dll 抓包逆向），
// 已用 master drm.py 交叉验证并实测出音频。
//
// 注意两点：
//  1. SHA-256 是篡改常量的变体（自定义 IV/调度/轮常量），不能用标准库；
//  2. ticks 必须走 float64 路径（×1e7 时超出 2^53，double 舍入参与运算，
//     用整数精确计算反而会得到不同的 CS64 半段）。
package tts

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math"
	"math/bits"
	"strings"
	"time"
)

const drmWinEpoch = 11644473600

// 变体 SHA-256 常量（FIPS 180-4 修改版，仅用于 DRM token）。
var (
	drmSHA256Initial = [8]uint32{
		0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
		0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19,
	}
	drmSHA256State = [8]uint32{
		0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A,
		0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2,
	}
	// 首块消息字 words[16..29] 的预置调度常量（14 个）
	drmSHA256Schedule = [14]uint32{
		0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA,
		0xA622EE8C, 0xD1DD9491, 0xC0DD25A0, 0xF9E70AB6,
		0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33,
		0xD258B060, 0x72766564,
	}
	// 标准 SHA-256 轮常量 K
	drmK = [64]uint32{
		0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5,
		0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
		0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3,
		0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
		0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC,
		0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
		0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7,
		0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
		0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13,
		0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
		0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3,
		0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
		0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5,
		0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
		0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208,
		0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
	}
	drmSHA256Adjustment = uint32(0xC9DC06A7) // 替换首块 K[14]
	drmSigma0Adjustment = uint32(0x059C0B80)
	drmSigma1Adjustment = uint32(0x000B92C0)
	drmCS64Factor       = uint32(0x82893933)
	drmCS64Adjustment0  = uint32(0xF2F90B1A)
	drmCS64Adjustment1  = uint32(0x0B1A0000)
	drmCS64Coefficients = [14][2]uint32{
		{0xE82E91B1, 0xB32700D0},
		{0x44DE24C6, 0x88DFF51D},
		{0x3BEB65BC, 0x29514038},
		{0xC89C5933, 0xB328CBDF},
		{0x8D1EC211, 0xD405B4D5},
		{0x314EF5D5, 0x26E55F3C},
		{0xE92491B1, 0x607801C6},
		{0xF0A5B9D5, 0x82B2C1FB},
		{0x06064CF3, 0xFA51A3DA},
		{0xDA79FA60, 0x207CC464},
		{0xBED20560, 0x3C3C74F3},
		{0x89F9C9F8, 0xD2D14B61},
		{0x35FA38C6, 0xBB04A2C1},
		{0xCB49E3C6, 0xC5626167},
	}
)

func drmRol16(v uint32) uint32 { return v<<16 | v>>16 }

// 小 sigma（单次截断变体）：先异或后取模，与标准 SHA-256 的逐项取模不同。
func drmSigma0(v uint32) uint32 { return v>>7 ^ v<<25 ^ v>>18 ^ v<<14 ^ v>>3 }
func drmSigma1(v uint32) uint32 { return v>>17 ^ v<<15 ^ v>>19 ^ v<<13 ^ v>>10 }

// drmRounds 执行 SHA-256 轮压缩（标准大 sigma/Ch/Maj），返回纯压缩输出
// （不含输入状态，由调用方按 upstream 语义决定加回谁）。
// blockConst=true 时首块使用替换过 K[14] 的轮常量。
func drmRounds(state [8]uint32, words []uint32, firstRound int, blockConst bool) [8]uint32 {
	k := drmK
	if blockConst {
		k[14] = drmSHA256Adjustment
	}
	a, b, c, d, e, f, g, h := state[0], state[1], state[2], state[3],
		state[4], state[5], state[6], state[7]
	for i := firstRound; i < 64; i++ {
		// 大 sigma 用循环移位（ROTR）；小 sigma（drmSigma0/1）才是带左移的变体
		s1 := bits.RotateLeft32(e, -6) ^ bits.RotateLeft32(e, -11) ^ bits.RotateLeft32(e, -25)
		t1 := h + s1 + (g ^ e&(f^g)) + k[i] + words[i]
		s0 := bits.RotateLeft32(a, -2) ^ bits.RotateLeft32(a, -13) ^ bits.RotateLeft32(a, -22)
		t2 := s0 + (a&b | c&(a|b))
		h, g, f = g, f, e
		e = d + t1
		d, c, b = c, b, a
		a = t1 + t2
	}
	return [8]uint32{a, b, c, d, e, f, g, h}
}

// drmSHA256Init 用消息前 7 字节构造变体初始状态（特殊首块 + 修改版 IV）。
func drmSHA256Init(prefix []byte) [8]uint32 {
	words := make([]uint32, 64)
	// words[0..13] 保持 0
	words[14] = uint32(prefix[0])<<16 | uint32(prefix[1])<<8 | uint32(prefix[2])
	words[15] = binary.BigEndian.Uint32(prefix[3:7])
	for index := 16; index < 30; index++ {
		value := drmSHA256Schedule[index-16]
		if index-2 >= 14 {
			if index == 16 {
				value += drmSigma1(words[index-2]) ^ drmSigma1Adjustment
			} else {
				value += drmSigma1(words[index-2])
			}
		}
		if index-7 >= 14 {
			value += words[index-7]
		}
		if index-15 >= 14 {
			if index == 29 {
				value += drmSigma0(words[index-15]) ^ drmSigma0Adjustment
			} else {
				value += drmSigma0(words[index-15])
			}
		}
		words[index] = value
	}
	words[30] = drmSigma1(words[28]) + words[23] + drmSigma0(words[15]) +
		words[14] + drmSHA256Adjustment - drmK[14]
	for index := 31; index < 64; index++ {
		x, y := words[index-2], words[index-15]
		words[index] = drmSigma1(x) + words[index-7] + drmSigma0(y) + words[index-16]
	}
	st := drmSHA256State
	working := drmRounds(st, words, 14, true)
	var out [8]uint32
	for i := 0; i < 8; i++ {
		out[i] = drmSHA256Initial[i] + working[i]
	}
	return out
}

// drmSHA256Digest 计算变体 SHA-256 摘要（32 字节）。
func drmSHA256Digest(data []byte) [32]byte {
	length := 57 + len(data)
	pad := (55 - length) % 64
	if pad < 0 {
		pad += 64
	}
	padded := make([]byte, 0, len(data)-7+1+pad+8)
	padded = append(padded, data[7:]...)
	padded = append(padded, 0x80)
	padded = append(padded, make([]byte, pad)...)
	var lenBuf [8]byte
	binary.BigEndian.PutUint64(lenBuf[:], uint64(length)*8)
	padded = append(padded, lenBuf[:]...)

	state := drmSHA256Init(data[:7])
	for off := 0; off < len(padded); off += 64 {
		var words [64]uint32
		for i := 0; i < 16; i++ {
			words[i] = binary.BigEndian.Uint32(padded[off+i*4 : off+i*4+4])
		}
		for index := 16; index < 64; index++ {
			x, y := words[index-2], words[index-15]
			words[index] = drmSigma1(x) + words[index-7] + drmSigma0(y) + words[index-16]
		}
		working := drmRounds(state, words[:], 0, false)
		for i := 0; i < 8; i++ {
			state[i] += working[i]
		}
	}
	var out [32]byte
	for i := 0; i < 8; i++ {
		binary.BigEndian.PutUint32(out[i*4:], state[i])
	}
	return out
}

// drmCS64 计算 CS64 摘要（两个 u32 字）。
func drmCS64(data []byte, digest [32]byte) (uint32, uint32) {
	keyA := binary.LittleEndian.Uint32(digest[0:4]) | 1
	keyB := binary.LittleEndian.Uint32(digest[4:8]) | 1
	f0 := keyA * drmCS64Factor
	f1 := keyB * drmCS64Factor

	terms := make([]uint32, 0, 28)
	offsets := make([]uint32, 0, 28)
	for i, co := range drmCS64Coefficients {
		if i%2 == 0 {
			terms = append(terms, co[0]*f0)
		} else {
			terms = append(terms, co[0]*f1)
		}
		offsets = append(offsets, co[1])
	}

	// b"\x00"+data 按小端 u32 切词，补零至偶数个
	raw := make([]byte, 0, len(data)+1+8)
	raw = append(raw, 0)
	raw = append(raw, data...)
	for len(raw)%4 != 0 {
		raw = append(raw, 0)
	}
	words := make([]uint32, len(raw)/4)
	for i := range words {
		words[i] = binary.LittleEndian.Uint32(raw[i*4:])
	}
	if len(words)%2 == 1 {
		words = append(words, 0)
	}
	for i, w := range words {
		var term, off uint32
		if i%2 == 0 {
			term = w * keyA
			off = drmRol16(w) * 0xEF0569FB
		} else {
			term = w * keyB
			off = drmRol16(w) * 0xC31713DB
		}
		if i == 0 {
			term += drmCS64Adjustment0 * f0
			off += drmCS64Adjustment1
		}
		terms = append(terms, term)
		offsets = append(offsets, off)
	}

	var swapAcc, swapLast, st, acc uint32
	for i := 0; i < len(terms); i += 2 {
		x, y := terms[i], terms[i+1]

		t := drmRol16(offsets[i] + x)
		q := t * 0x76F50F34
		swapAcc += drmRol16(q)*0xC3EFEA97 + q
		t = drmRol16(offsets[i+1] + y)
		q = t * 0x1881CE3C
		swapLast = drmRol16(q)*0x35BD1EC9 + q
		swapAcc += swapLast

		st = st*keyA + x
		st = drmRol16(st) * 0xCF98B111
		st = drmRol16(st) * 0x87085B9F
		st = drmRol16(st) * 0x12CEB96D
		st = drmRol16(st) * 0x257E1D83
		acc += st

		t = st*keyB + y
		t = drmRol16(t) * 0xA27416F5
		t = drmRol16(t) * 0xD38396FF
		st = drmRol16(drmRol16(t)*0x7C932B89) * 0xBFA49F69
		acc += st
	}
	return swapLast ^ st, swapAcc ^ acc
}

// secMsgGECv2 生成 v2 Sec-MS-GEC token（"<16位hex>-<64位hex>"）。
// ticks 必须走 float64 路径：×1e7 后超出 double 精度，原生实现的舍入
// 结果参与哈希，用整数精确计算会得到不匹配的 CS64 半段。
func secMsgGECv2(now time.Time) string {
	ticks := float64(now.Unix())
	ticks += drmWinEpoch
	ticks -= math.Mod(ticks, 300)
	ticks *= 1e9 / 100 // 转 100ns ticks
	strToHash := fmt.Sprintf("%.0f%s", ticks, edgeTrustedToken)

	digest := drmSHA256Digest([]byte(strToHash))
	w0, w1 := drmCS64([]byte(strToHash), digest)
	var buf [8]byte
	binary.LittleEndian.PutUint32(buf[0:4], w0)
	binary.LittleEndian.PutUint32(buf[4:8], w1)
	cs64 := strings.ToUpper(hex.EncodeToString(buf[:]))
	sha := strings.ToUpper(hex.EncodeToString(digest[:]))
	return cs64 + "-" + sha
}
