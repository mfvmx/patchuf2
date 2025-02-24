"use strict";

// copy entire configkeys.h from https://github.com/microsoft/pxt-common-packages/blob/master/libs/base/configkeys.h
const CONFIG_KEYS_H =
    `
#ifndef __PXT_CONFIGKEYS_H
#define __PXT_CONFIGKEYS_H

// used by pins.cpp to mask off the pin name from any config
// lower 16 pins of value are the pin name
#define CFG_PIN_NAME_MSK 0x0000ffff
// upper 16 bits of value is any configuration of the pin.
#define CFG_PIN_CONFIG_MSK 0xffff0000

// begin optional pin configurations
#define CFG_PIN_CONFIG_ACTIVE_LO 0x10000


#define CFG_MAGIC0 0x1e9e10f1
#define CFG_MAGIC1 0x20227a79

// these define keys for getConfig() function
#define CFG_VERSION_MAJOR 1
#define CFG_VERSION_MINOR 2
#define CFG_VERSION_BUILD 3
#define CFG_VERSION_RELEASE 4
#define CFG_DEVICE_TYPE 5
#define CFG_DEVICE_ID 6
#define CFG_BOOTLOADER_BOARD_ID 7
#define CFG_UF2_FAMILY 8
#define CFG_DEVICE_FLASH_EXT 9
#define CFG_HW_VERSION_MAJOR 10
#define CFG_HW_VERSION_MINOR 11
#define CFG_HW_VERSION_BUILD 12
#define CFG_HW_VERSION_RELEASE 13
#define CFG_fourteen 14
#define CFG_fifteen 15
#define CFG_sixteen 16

#endif
`

const configKeys = {}
CONFIG_KEYS_H.replace(/#define\s+CFG_(\w+)\s+(\w+)/g, function (m, name, value) {
    configKeys[name] = parseInt(value);
    return "";
})

const enums = {
    // these are the same as the default I2C ID
    BOOTLOADER_BOARD_ID: {
        CONTROLLER: 0x197ffd02,
        OUTDOORM0: 0xf7e06bae,
        OUTDOORM4: 0xc4a8b887,
        INDOORM0: 0x754c9667,
        INDOORM4: 0x1b68c777,
    },
    UF2_FAMILY: {
        ATSAMD21: 0x68ed2b88,
        ATSAML21: 0x1851780a,
        ATSAMD51: 0x55114460,
        NRF52840: 0x1b57745f,
        STM32F103: 0x5ee21072,
        STM32F401: 0x57755a57,
        ATMEGA32: 0x16573617,
        CYPRESS_FX2: 0x5a18069b,
    },
    PINS_PORT_SIZE: {
        PA_16: 0x10, // PA00-PA15, PB00-PB15, ... - STM32
        PA_32: 0x20, // PA00-PA31, ... - ATSAMD
        P0_16: 0x1010, // P0_0-P0_15, P1_0-P1_15, ...
        P0_32: 0x1020, // P0_0-P0_32, ... - NRF
    },
    DEFAULT_BUTTON_MODE: {
        ACTIVE_HIGH_PULL_DOWN: 0x11,
        ACTIVE_HIGH_PULL_UP: 0x21,
        ACTIVE_HIGH_PULL_NONE: 0x31,
        ACTIVE_LOW_PULL_DOWN: 0x10,
        ACTIVE_LOW_PULL_UP: 0x20,
        ACTIVE_LOW_PULL_NONE: 0x30,
    },
    DISPLAY_TYPE: {
        ST7735: 7735,
        ILI9341: 9341,
    },
    ".": {
        BTN_FLAG_ACTIVE_HIGH: 0x110000,
        BTN_FLAG_ACTIVE_LOW: 0x200000,
        BTN_OFFSET_ANALOG_PLUS: 1100,
        BTN_OFFSET_ANALOG_MINUS: 1200,
    }
}


let infoMsg = ""

function log(msg) {
    msg = "# " + msg
    infoMsg += msg + "\n"
    console.log(msg)
}

function help() {
    console.log(`
USAGE: node patch-cfg.js file.uf2 [patch.cf2]

Without .cf2 file, it will parse config in the UF2 file and print it out
(in .cf2 format).

With .cf2 file, it will patch in-place the UF2 file with specified config.
`)
    process.exit(1)
}

function readBin(fn) {
    const fs = require("fs")

    if (!fn) {
        console.log("Required argument missing.")
        help()
    }

    try {
        return fs.readFileSync(fn)
    } catch (e) {
        console.log("Cannot read file '" + fn + "': " + e.message)
        help()
    }
}
const configInvKeys = {}

const UF2_MAGIC_START0 = 0x0A324655 // "UF2\n"
const UF2_MAGIC_START1 = 0x9E5D5157 // Randomly selected
const UF2_MAGIC_END = 0x0AB16F30 // Ditto

const CFG_MAGIC0 = 0x1e9e10f1
const CFG_MAGIC1 = 0x20227a79

let all_defines = {}

function configkeysH() {
    let r = "#ifndef __CONFIGKEYS_H\n#define __CONFIGKEYS_H 1\n\n"

    const add = (k, v) => {
        all_defines[k] = v
        if (v > 1000 || !/^CFG_/.test(k))
            v = "0x" + v.toString(16)
        else
            v += ""
        r += "#define " + k + " " + v + "\n"
    }

    add("CFG_MAGIC0", CFG_MAGIC0)
    add("CFG_MAGIC1", CFG_MAGIC1)
    r += "\n"

    for (let k of Object.keys(configKeys)) {
        add("CFG_" + k, configKeys[k])
    }
    for (let k of Object.keys(enums)) {
        r += "\n"
        for (let kk of Object.keys(enums[k])) {
            let n = k == "." ? kk : `${k}_${kk}`
            add(n, enums[k][kk])
        }
    }
    r += "\n#endif // __CONFIGKEYS_H\n"
    return r
}

function err(msg) {
    log("Fatal error: " + msg)
    if (typeof window == "undefined") {
        process.exit(1)
    } else {
        throw new Error(msg)
    }
}

function read32(buf, off) {
    return (buf[off + 0] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0
}

function write32(buf, off, v) {
    buf[off + 0] = v & 0xff
    buf[off + 1] = (v >> 8) & 0xff
    buf[off + 2] = (v >> 16) & 0xff
    buf[off + 3] = (v >> 24) & 0xff
}

function patchHFile(file, patch) {
    configkeysH()
    let resFile = ""
    let inZone = false
    let flags = {}
    let lineNo = 0
    let nums = []
    for (let line0 of file.split(/\n/)) {
        lineNo++
        let append = line0 + "\n"
        let line = line0.trim().replace(/\/\/.*/, "")
        if (inZone) {
            if (line.indexOf("/* CF2 END */") >= 0) {
                inZone = false
                if (patch) {
                    let portSize = lookupCfg(patch, configKeys.PINS_PORT_SIZE)
                    let s = ""
                    let size = flags["size"] || 100
                    let numentries = patch.length >> 1
                    size = Math.max(size, numentries + 4)
                    s += `    ${CFG_MAGIC0}, ${CFG_MAGIC1}, // magic\n`
                    s += `    ${numentries}, ${size},  // used entries, total entries\n`
                    for (let i = 0; i < numentries; ++i) {
                        let k = patch[i * 2]
                        let v = patch[i * 2 + 1]
                        s += `    ${k}, 0x${v.toString(16)}, // ${showKV(k, v, portSize, patch)}\n`
                    }
                    s += "   "
                    for (let i = 0; i < size - numentries; ++i) {
                        if (i && i % 16 == 0)
                            s += "\n   "
                        s += " 0, 0,"
                    }
                    s += "\n"
                    append = s + line0 + "\n"
                }
            } else {
                append = ""
                let toks = line.split(/,\s*/).map(s => s.trim()).filter(s => !!s)
                for (let tok of toks) {
                    let n = parseInt(tok)
                    if (isNaN(n)) {
                        n = all_defines[tok]
                        if (n === undefined) {
                            let portSize = lookupCfg(nums, configKeys.PINS_PORT_SIZE)
                            if (portSize) portSize &= 0xfff;
                            let pp = parsePinName(tok.replace(/^PIN_/, ""), portSize)
                            if (pp !== undefined) {
                                n = pp
                            } else {
                                err(`unknown value ${tok} at line ${lineNo}`)
                            }
                        }
                    }
                    nums.push(n)
                }
            }
        } else {
            let m = /\/\* CF2 START (.*)/.exec(line)
            if (m) {
                inZone = true
                for (let k of m[1].split(/\s+/)) {
                    let mm = /^(\w+)=(\d+)$/.exec(k)
                    if (mm)
                        flags[mm[1]] = parseInt(mm[2])
                    else
                        flags[k] = true
                }
            }
        }
        resFile += append
    }

    if (nums.length) {
        if (nums[0] != CFG_MAGIC0 || nums[1] != CFG_MAGIC1)
            err("no magic in H file")
        nums = nums.slice(4)
        for (let i = 0; i < nums.length; i += 2) {
            if (nums[i] == 0) {
                if (nums.slice(i).some(x => x != 0))
                    err("config keys follow zero terminator")
                else
                    nums = nums.slice(0, i)
                break
            }
        }
    }

    return {
        patched: resFile,
        data: nums
    }
}

function bufToString(buf) {
    let s = ""
    for (let i = 0; i < buf.length; ++i)
        s += String.fromCharCode(buf[i])
    return s
}

function stringToBuf(str) {
    let buf = new Uint8Array(str.length)
    for (let i = 0; i < buf.length; ++i)
        buf[i] = str.charCodeAt(i)
    return buf
}

function readWriteConfig(buf, patch) {
    let patchPtr = null
    let origData = []
    let cfgLen = 0
    let isUF2 = false
    if (read32(buf, 0) == UF2_MAGIC_START0) {
        isUF2 = true
        log("detected UF2 file")
    } else {
        let stackBase = read32(buf, 0)
        if ((stackBase & 0xff000003) == 0x20000000 &&
            (read32(buf, 4) & 1) == 1) {
            log("detected BIN file")
        } else {
            let str = bufToString(buf)
            if (str.indexOf("/* CF2 START") >= 0) {
                log("detected CF2 header file")
                let rr = patchHFile(str, patch)
                console.log(rr.data)
                return patch ? stringToBuf(rr.patched) : rr.data
            } else {
                err("unknown file format")
            }
        }
    }
    if (patch)
        patch.push(0, 0)
    for (let off = 0; off < buf.length; off += 512) {
        let start = 0
        let payloadLen = 512
        let addr = off

        if (isUF2) {
            start = 32
            if (read32(buf, off) != UF2_MAGIC_START0 ||
                read32(buf, off + 4) != UF2_MAGIC_START1) {
                err("invalid data at " + off)
            }
            payloadLen = read32(buf, off + 16)
            addr = read32(buf, off + 12) - 32
        }

        for (let i = start; i < start + payloadLen; i += 4) {
            if (read32(buf, off + i) == CFG_MAGIC0 &&
                read32(buf, off + i + 4) == CFG_MAGIC1) {
                let addrS = "0x" + (addr + i).toString(16)
                if (patchPtr === null) {
                    log(`Found CFG DATA at ${addrS}`)
                    patchPtr = -4
                } else {
                    if (patch) {
                        log(`Also patching at ${addrS}`)
                        patchPtr = -4
                    } else {
                        log(`Skipping second CFG DATA at ${addrS}`)
                    }
                }
            }

            if (patchPtr !== null) {
                if (patchPtr == -2) {
                    cfgLen = read32(buf, off + i)
                    if (patch)
                        write32(buf, off + i, (patch.length >> 1) - 1)
                }

                if (patchPtr >= 0) {
                    if (origData.length < cfgLen * 2 + 40)
                        origData.push(read32(buf, off + i))
                    if (patch) {
                        if (patchPtr < patch.length) {
                            write32(buf, off + i, patch[patchPtr])
                        }
                    }
                }
                patchPtr++
            }
        }
    }

    let len0 = cfgLen * 2
    origData.push(0, 0)
    while (origData[len0])
        len0 += 2
    origData = origData.slice(0, len0 + 2)
    if (len0 != cfgLen * 2)
        log("size information incorrect; continuing anyway")

    if (origData.length == 0)
        err("config data not found")
    if (patch && patchPtr < patch.length)
        err("no space for config data")
    let tail = origData.slice(origData.length - 2)
    if (tail.some(x => x != 0))
        err("config data not zero terminated: " + tail.join(","))
    origData = origData.slice(0, origData.length - 2)
    return patch ? buf : origData
}

function lookupCfg(cfgdata, key) {
    for (let i = 0; i < cfgdata.length; i += 2)
        if (cfgdata[i] == key)
            return cfgdata[i + 1]
    return null
}

function pinToString(pinNo, portSize) {
    if (!portSize || pinNo >= 1000)
        return "P_" + pinNo

    let useLetters = true
    let theSize = portSize & 0xfff
    if (portSize & 0x1000) {
        useLetters = true
    }
    let port = (pinNo / theSize) | 0
    let pin = pinNo % theSize
    if (useLetters) {
        return "P" + String.fromCharCode(65 + port) + ("0" + pin.toString()).slice(-2)
    } else {
        return "P" + port + "_" + pin
    }
}

function isHeaderPin(n) {
    return /^PIN_(MOSI|MISO|SCK|SDA|SCL|RX|TX|[AD]\d+)$/.test(n)
}

function keyWeight(k) {
    if (k == "PINS_PORT_SIZE")
        return 10
    if (isHeaderPin(k))
        return 20
    if (/^PIN_/.test(k))
        return 30
    return 40
}

function expandNum(k) {
    return k.replace(/\d+/g, f => {
        if (f.length > 4)
            return f
        return ("0000" + f).slice(-4)
    })
}

function cmpKeys(a, b) {
    a = a.replace(/ =.*/, "")
    b = b.replace(/ =.*/, "")
    if (a == b)
        return 0
    let d = keyWeight(a) - keyWeight(b)
    if (d) return d
    let aa = expandNum(a)
    let bb = expandNum(b)
    if (aa < bb) return -1
    else if (bb < aa) return 1
    else if (a < b) return -1
    else return 1
}

function showKV(k, v, portSize, data) {
    let vn = ""

    let kn = configInvKeys[k + ""] || ""

    if (enums[kn]) {
        for (let en of Object.keys(enums[kn])) {
            if (enums[kn][en] == v) {
                vn = en
                break
            }
        }
    }

    if (vn == "") {
        if (/_CFG/.test(kn) || v > 10000)
            vn = "0x" + v.toString(16)
        else if (/^PIN_/.test(kn)) {
            if (data && !isHeaderPin(kn)) {
                for (let pn of Object.keys(configKeys)) {
                    if (isHeaderPin(pn) && lookupCfg(data, configKeys[pn]) === v) {
                        vn = pn
                        break
                    }
                }
            }
            if (!vn)
                vn = pinToString(v, portSize)
        } else
            vn = v + ""
    }

    if (kn == "")
        kn = "_" + k

    return `${kn} = ${vn}`
}

function readConfig(buf) {
    init()
    let cfgdata = readWriteConfig(buf, null)
    let portSize = lookupCfg(cfgdata, configKeys.PINS_PORT_SIZE)
    let numentries = cfgdata.length >> 1
    let lines = []
    for (let i = 0; i < numentries; ++i) {
        lines.push(showKV(cfgdata[i * 2], cfgdata[i * 2 + 1], portSize, cfgdata))
    }
    lines.sort(cmpKeys)
    return lines.length ? lines.join("\n") : "Empty config."
}

function parsePinName(v, portSize) {
    let thePort = -1
    let pin = -1

    v = v.trim()

    v = v.replace(/^DAL\./, "")

    const env = enums["."][v]
    if (env !== undefined)
        return env

    let m = /(.*)([\|+])(.*)/.exec(v)
    if (m) {
        let v0 = parsePinName(m[1], portSize)
        let v1 = parsePinName(m[3], portSize)
        if (v0 === undefined || v1 === undefined)
            return undefined
        v0 = parseInt(v0)
        v1 = parseInt(v1)
        return "" + (m[2] == "|" ? v0 | v1 : v0 + v1)
    }

    m = /^P([A-Z])_?(\d+)$/.exec(v)
    if (m) {
        pin = parseInt(m[2])
        thePort = m[1].charCodeAt(0) - 65
    }

    m = /^P(\d+)_(\d+)$/.exec(v)
    if (m) {
        pin = parseInt(m[2])
        thePort = parseInt(m[1])
    }

    if (thePort >= 0) {
        if (!portSize) err("PINS_PORT_SIZE not specified, while trying to parse PIN " + v)
        if (pin >= portSize) err("Pin name invalid: " + v)
        return (thePort * portSize + pin) + ""
    }

    m = /^P_?(\d+)$/.exec(v)
    if (m)
        return m[1]

    return undefined
}

function patchConfig(buf, cfg) {
    init()
    const cfgMap = {}
    let lineNo = 0
    for (let line of cfg.split(/\n/)) {
        lineNo++
        line = line.replace(/(#|\/\/).*/, "")
        line = line.trim()
        if (!line)
            continue
        let m = /(\w+)\s*=\s*([^#]+)/.exec(line)
        if (!m)
            err("syntax error at config line " + lineNo)
        let kn = m[1].toUpperCase()
        let k = configKeys[kn]
        if (!k && /^_\d+$/.test(kn))
            k = parseInt(kn.slice(1))
        if (!k)
            err("Unrecognized key name: " + kn)
        cfgMap[k + ""] = m[2]
    }

    let cfgdata = readWriteConfig(buf, null)

    for (let i = 0; i < cfgdata.length; i += 2) {
        let k = cfgdata[i] + ""
        if (!cfgMap.hasOwnProperty(k))
            cfgMap[k] = cfgdata[i + 1] + ""
    }

    const forAll = f => {
        for (let k of Object.keys(cfgMap)) {
            let kn = configInvKeys[k]
            f(kn, k, cfgMap[k])
        }
    }

    // expand enums
    forAll((kn, k, v) => {
        let e = enums[kn]
        if (e && e[v.toUpperCase()])
            cfgMap[k] = e[v] + ""
    })

    let portSize = cfgMap[configKeys.PINS_PORT_SIZE]
    if (portSize) portSize = parseInt(portSize)
    let portSize0 = portSize
    if (portSize)
        portSize &= 0xfff;

    // expand pin names
    forAll((kn, k, v) => {
        let p = parsePinName(v, portSize)
        if (p)
            cfgMap[k] = p
    })

    // expand existing keys
    for (let i = 0; i < 10; ++i)
        forAll((kn, k, v) => {
            if (configKeys[v]) {
                let curr = cfgMap[configKeys[v] + ""]
                if (curr == null)
                    err("Value not specified, but referenced: " + v)
                cfgMap[k] = curr
            }
        })

    let changes = ""
    forAll((kn, k, v) => {
        v = v.toUpperCase()
        if (v == "NULL" || v == "UNDEFINED") {
            let old = lookupCfg(cfgdata, k)
            changes += "remove " + showKV(k, old, portSize0) + "\n"
            delete cfgMap[k]
        }
    })

    forAll((kn, k, v) => {
        if (isNaN(parseInt(v)))
            err("Value not understood: " + v)
    })

    let sorted = Object.keys(cfgMap)
    sorted.sort((a, b) => parseInt(a) - parseInt(b))
    let patch = []
    for (let k of sorted) {
        patch.push(parseInt(k))
        patch.push(parseInt(cfgMap[k]))
    }

    for (let i = 0; i < patch.length; i += 2) {
        let k = patch[i]
        let v = patch[i + 1]
        let old = lookupCfg(cfgdata, k)
        if (old != v) {
            let newOne = showKV(k, v, portSize0)
            if (old !== null) {
                let oldOne = showKV(k, old, portSize0)
                newOne += " (was: " + oldOne.replace(/.* = /, "") + ")"
            }
            changes += newOne + "\n"
        }
    }

    let patched = readWriteConfig(buf, patch)

    return {
        changes,
        patched
    }
}

function parseHFile(hFile) {
    if (!hFile) return
    for (let line of hFile.split(/\n/)) {
        line = line.trim()
        let m = /#define\s+CFG_(\w+)\s+(\d+)/.exec(line)
        if (m) {
            let k = m[1]
            let v = parseInt(m[2])
            configKeys[k] = parseInt(v)
            configInvKeys[v + ""] = k
            console.log(`  ${k}: ${v},`)
        }
    }
}

function init() {
    for (let k of Object.keys(configKeys)) {
        let v = configKeys[k]
        configInvKeys[v + ""] = k
    }
}

function main() {
    let uf2 = readBin(process.argv[2])

    if (process.argv[3]) {
        let cfg = readBin(process.argv[3]).toString("utf8")
        let r = patchConfig(uf2, cfg)
        if (!r.changes)
            console.log("No changes.")
        else
            console.log("\nChanges:\n" + r.changes)
        console.log("# Writing config...")
        fs.writeFileSync(process.argv[2], r.patched)
    } else {
        console.log(readConfig(uf2))
    }
}


if (typeof window == "undefined")
    main()