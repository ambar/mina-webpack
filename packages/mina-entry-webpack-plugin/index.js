const path = require('path')
const fs = require('fs-extra')
const resolveFrom = require('resolve-from')
const { urlToRequest } = require('loader-utils')
const { parseComponent } = require('vue-template-compiler')
const SingleEntryPlugin = require('webpack/lib/SingleEntryPlugin')
const MultiEntryPlugin = require('webpack/lib/MultiEntryPlugin')

function basename (fullpath) {
  return path.basename(fullpath, path.extname(fullpath))
}

function extname (fullpath, ext) {
  return path.format({
    dir: path.dirname(fullpath),
    name: basename(fullpath),
    ext: ext,
  })
}

function isModuleUrl (url) {
  return !!url.match(/^~/)
}

function addEntry (context, item, name) {
	if (Array.isArray(item)) {
    return new MultiEntryPlugin(context, item, name)
	}
	return new SingleEntryPlugin(context, item, name)
}

function readConfig (fullpath) {
  return fs.readFile(fullpath)
    .then((buffer) => {
      let blocks = parseComponent(buffer.toString()).customBlocks
      let matched = blocks.find((block) => block.type === 'config')
      if (!matched || !matched.content || !matched.content.trim()) {
        return {}
      }
      return JSON.parse(matched.content)
    })
}

function getUrlsFromConfig (config) {
  if (config && Array.isArray(config.pages)) {
    return config.pages.map((page) => `${page}.mina`)
  }
  return []
}

function getItems (context, url) {
  let isModule = isModuleUrl(url)
  let request = urlToRequest(url)
  let current = {
    url,
    request,
    isModule: isModule,
    fullpath: isModule ? resolveFrom(context, request) : path.resolve(context, url),
  }
  return Promise.resolve(current.fullpath)
    .then(readConfig)
    .then(getUrlsFromConfig)
    .then((urls) => {
      if (urls.length === 0) {
        return current
      }
      return Promise.all([ Promise.resolve(current), ...(urls.map((url) => getItems(context, url))) ])
    })
}

module.exports = class MinaEntryWebpackPlugin {
  constructor (options = {}) {
    this.module = options.module || 'mina_modules'
  }

  rewrite (compiler, callback) {
    let { context, entry } = compiler.options

    getItems(context, entry)
      .then((items) => {
        items.forEach(({ isModule, request, fullpath }) => {
          // replace '..' to '_'
          let name = extname(urlToRequest(path.relative(context, fullpath).replace(/\.\./g, '_')), '.js')
          compiler.apply(addEntry(context, request, name))
        })
        callback()
      })
      .catch(callback)
  }

  apply (compiler) {
    compiler.plugin('run', this.rewrite.bind(this))
    compiler.plugin('watch-run', this.rewrite.bind(this))

    compiler.plugin('entry-option', () => true)
  }
}
