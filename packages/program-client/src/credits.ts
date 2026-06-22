/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/credits.json`.
 */
export type Credits = {
  "address": "FunwpPA4fah5czxHfhbDD6iQE9L3wPUvuEzUkd5gL6Fv",
  "metadata": {
    "name": "credits",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "your ai slop bores me — on-chain credit economy (Solana devnet / MagicBlock ER)"
  },
  "instructions": [
    {
      "name": "earn",
      "docs": [
        "Earn 1 credit for an accepted answer. Earned credits may exceed the refill",
        "cap (the cap only limits passive accrual; you actively earned these)."
      ],
      "discriminator": [
        120,
        28,
        58,
        147,
        140,
        17,
        17,
        110
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player.authority",
                "account": "player"
              }
            ]
          }
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "initConfig",
      "docs": [
        "Initialize the singleton Config PDA. Callable once. The signer becomes admin."
      ],
      "discriminator": [
        23,
        235,
        115,
        232,
        168,
        96,
        1,
        231
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "initConfigArgs"
            }
          }
        }
      ]
    },
    {
      "name": "initPlayer",
      "docs": [
        "Create a Player PDA for `authority` with a small starting balance.",
        "MUST be signed by `server_authority` (anti-sybil — see trust model above)."
      ],
      "discriminator": [
        114,
        27,
        219,
        144,
        50,
        15,
        228,
        66
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "authority"
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "refill",
      "docs": [
        "Passive refill: if at least `refill_interval` seconds have elapsed, add",
        "`refill_amount` (clamped to `max_credits`) and reset the clock."
      ],
      "discriminator": [
        128,
        207,
        142,
        11,
        54,
        232,
        38,
        201
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player.authority",
                "account": "player"
              }
            ]
          }
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "refund",
      "docs": [
        "Refund `amount` previously-spent credits (an unclaimed prompt expired)."
      ],
      "discriminator": [
        2,
        96,
        183,
        251,
        63,
        208,
        46,
        46
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player.authority",
                "account": "player"
              }
            ]
          }
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "spend",
      "docs": [
        "Spend `amount` credits (a prompt submission). Errors if balance is too low."
      ],
      "discriminator": [
        242,
        205,
        255,
        87,
        101,
        217,
        245,
        57
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player.authority",
                "account": "player"
              }
            ]
          }
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "player",
      "discriminator": [
        205,
        222,
        112,
        7,
        165,
        155,
        206,
        218
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "insufficientCredits",
      "msg": "not enough credits for this action 💀"
    },
    {
      "code": 6001,
      "name": "refillNotReady",
      "msg": "refill isn't ready yet, touch grass"
    },
    {
      "code": 6002,
      "name": "unauthorized",
      "msg": "signer is not authorized for this action"
    },
    {
      "code": 6003,
      "name": "maxCreditsReached",
      "msg": "already at max credits"
    },
    {
      "code": 6004,
      "name": "mathOverflow",
      "msg": "arithmetic overflow"
    },
    {
      "code": 6005,
      "name": "invalidConfig",
      "msg": "invalid config parameters"
    }
  ],
  "types": [
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "serverAuthority",
            "type": "pubkey"
          },
          {
            "name": "creditCostText",
            "type": "u64"
          },
          {
            "name": "creditCostImage",
            "type": "u64"
          },
          {
            "name": "refillAmount",
            "type": "u64"
          },
          {
            "name": "refillInterval",
            "type": "i64"
          },
          {
            "name": "maxCredits",
            "type": "u64"
          },
          {
            "name": "startingBalance",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "initConfigArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "serverAuthority",
            "type": "pubkey"
          },
          {
            "name": "creditCostText",
            "type": "u64"
          },
          {
            "name": "creditCostImage",
            "type": "u64"
          },
          {
            "name": "refillAmount",
            "type": "u64"
          },
          {
            "name": "refillInterval",
            "type": "i64"
          },
          {
            "name": "maxCredits",
            "type": "u64"
          },
          {
            "name": "startingBalance",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "player",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "balance",
            "type": "u64"
          },
          {
            "name": "lastRefill",
            "type": "i64"
          },
          {
            "name": "answersGiven",
            "type": "u64"
          },
          {
            "name": "promptsSent",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
