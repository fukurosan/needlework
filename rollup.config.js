import pkg from "./package.json"
import { terser } from "rollup-plugin-terser"

const DIST_FOLDER = "dist"
const LIBRARY_NAME = pkg.name
const VERSION = pkg.version
const AUTHOR = pkg.author
const DESCRIPTION = pkg.description
const BANNER = `/** @preserve @license @cc_on
 * ----------------------------------------------------------
 * ${LIBRARY_NAME} version ${VERSION}
 * ${DESCRIPTION}
 * Copyright (c) ${new Date().getFullYear()} ${AUTHOR}
 * All Rights Reserved. MIT License
 * https://mit-license.org/
 * ----------------------------------------------------------
 */\n`

export default [
    {
        input: "./index.js",
        output: [
            {
                file: `${DIST_FOLDER}/${LIBRARY_NAME}.js`,
                format: "iife",
                banner: BANNER,
            }
        ],
        plugins: [
            terser({
                format: {
                    comments(node, comment) {
                        const text = comment.value
                        const type = comment.type
                        if (type == "comment2") {
                            return /@preserve|@license|@cc_on/i.test(text)
                        }
                    }
                }
            })
        ]
    }
]