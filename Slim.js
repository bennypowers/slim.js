console.log('SlimJS')

class Slim extends HTMLElement {

    static tag(tag, clazz) {
        document.registerElement(tag, clazz)
    }

    static plugin(phase, plugin) {
        if (phase !== 'create' && phase !== 'beforeRender' && phase !== 'afterRender') {
            throw "Supported phase can be create, beforeRender or afterRender only"
        }
        Slim.__plugins[phase].push(plugin)
    }

    static __runPlugins(phase, element) {
        Slim.__plugins[phase].forEach( fn => {
            fn(element)
        })
    }

    static __moveChildren(source, target, activate) {
        while (source.children.length) {
            let child = source.children[0]
            target.appendChild(source.children[0])
        }
        let children = Array.prototype.slice.call( target.querySelectorAll('*'))
        for (let child of children) {
            if (activate && child.isSlim) {
                child.createdCallback(true)
            }
        }
    }

    static __lookup(obj, desc) {
        var arr = desc.split(".");
        var prop = arr[0]
        while(arr.length && obj) {
            obj = obj[prop = arr.shift()]
        }
        return {source: desc, prop:prop, obj:obj};
    }

    static __createRepeater(descriptor) {
        let repeater = document.createElement('slim-repeat')
        repeater.sourceNode = descriptor.target
        repeater._boundParent = descriptor.source
        descriptor.target.parentNode.insertBefore(repeater, descriptor.target)
        descriptor.target.parentNode.removeChild(descriptor.target)
        repeater.setAttribute('source', descriptor.properties[0])
        descriptor.repeater = repeater
    }

    static __dashToCamel(dash) {
        return dash.indexOf('-') < 0 ? dash : dash.replace(/-[a-z]/g, m => {return m[1].toUpperCase()})
    }

    static __camelToDash(camel) {
        return camel.replace(/([A-Z])/g, '-$1').toLowerCase();
    }

    find(selector) {
        return this.querySelector(selector)
    }

    findAll(selector) {
        return Array.prototype.slice.call(this.querySelectorAll(selector))
    }

    watch(prop, executor) {
        let descriptor = {
            type: 'W',
            properties: [ prop ],
            executor: executor,
            target: this,
            source: this
        }
        this.__bind(descriptor)
    }

    __bind(descriptor) {
        descriptor.properties.forEach(
            prop => {
                let rootProp
                if (prop.indexOf('.') > 0) {
                    rootProp = prop.split('.')[0]
                } else {
                    rootProp = prop
                }
                let source = descriptor.target._boundParent
                source._bindings[rootProp] = source._bindings[rootProp] || {
                    value: source[rootProp],
                    executors: []
                }
                if (!source.__lookupGetter__(prop)) source.__defineGetter__(prop, function() {
                        return this._bindings[prop].value
                    })
                if (!source.__lookupSetter__(prop)) source.__defineSetter__(prop, function(x) {
                        this._bindings[prop].value = x
                        if (descriptor.sourceText) {
                            descriptor.target.textContent = descriptor.sourceText
                        }
                        this._executeBindings()
                    })
                let executor
                if (descriptor.type === 'P') {
                    executor = () => {
                        let value = Slim.__lookup(source, prop).obj //this._bindings[prop].value
                        descriptor.target[ Slim.__dashToCamel(descriptor.attribute) ] = value
                        descriptor.target.setAttribute( descriptor.attribute, value )
                    }
                } else if (descriptor.type === 'M') {
                    executor = () => {
                        let value = source[ descriptor.method ].apply( source,
                            descriptor.properties.map( prop => { return source[prop] }))
                        descriptor.target[ Slim.__dashToCamel(descriptor.attribute) ] = value
                        descriptor.target.setAttribute( descriptor.attribute, value )
                    }
                } else if (descriptor.type === 'T') {
                    executor = () => {
                        let source = descriptor.target._boundParent
                        descriptor.target.textContent = descriptor.target.textContent.replace(`[[${prop}]]`, Slim.__lookup(source, prop).obj)
                    }
                } else if (descriptor.type === 'R') {
                    executor = () => {
                        descriptor.repeater.renderList()
                    }
                } else if (descriptor.type === 'W') {
                    executor = () => {
                        descriptor.executor(Slim.__lookup(source, prop).obj)
                    }
                }
                source._bindings[rootProp].executors.push( executor )
            }
        )
    }

    static __processRepeater(attribute) {
        return {
            type: 'R',
            target: attribute.ownerElement,
            attribute: attribute.nodeName,
            properties: [ attribute.nodeValue ],
            source: attribute.ownerElement._boundParent
        }
    }

    static __processAttribute(attribute) {
        let child = attribute.ownerElement
        if (attribute.nodeName === 'slim-repeat') {
            return Slim.__processRepeater(attribute)
        }

        const rxInject = /\{(.+[^(\((.+)\))])\}/.exec(attribute.nodeValue)
        const rxProp = /\[(.+[^(\((.+)\))])\]/.exec(attribute.nodeValue)
        const rxMethod = /\[(.+)(\((.+)\)){1}\]/.exec(attribute.nodeValue)

        if (rxMethod) {
            return {
                type: 'M',
                target: attribute.ownerElement,
                attribute: attribute.nodeName,
                method: rxMethod[1],
                properties: rxMethod[3].replace(' ','').split(',')
            }
        } else if (rxProp) {
            return {
                type: 'P',
                target: attribute.ownerElement,
                attribute: attribute.nodeName,
                properties: [ rxProp[1] ]
            }
        } else if (rxInject) {
            return {
                type: 'I',
                target: attribute.ownerElement,
                attribute: attribute.nodeName,
                factory: rxInject[1]
            }
        }
    }

    get isVirtual() {
        let node = this
        while (node) {
            node = node.parentNode
            if (!node) {
                return true
            }
            if (node.nodeName === 'BODY') {
                return false
            }
        }
        return true
    }

    createdCallback(force = false) {
        this.initialize()
        if (this.isVirtual && !force) return
        if (!this.__onCreatedComplete) this.onBeforeCreated()
        this._captureBindings()
        Slim.__runPlugins('create', this)
        if (!this.__onCreatedComplete) this.onCreated()
        this.__onCreatedComplete = true
        this.onBeforeRender()
        Slim.__runPlugins('beforeRender', this)
        Slim.__moveChildren( this._virtualDOM, this, true )
        this.onAfterRender()
        Slim.__runPlugins('afterRender', this)
        this.update()
        // this.appendChild(this._virtualDOM)
    }

    initialize(forceNewVirtualDOM = false) {
        this._bindings = this._bindings || {}
        this._boundChildren = this._boundChildren || []
        this.alternateTemplate = this.alternateTemplate || null
        if (forceNewVirtualDOM) {
            this._virtualDOM = document.createElement('slim-root')
        }
        this._virtualDOM = this._virtualDOM || document.createElement('slim-root')
    }

    get isSlim() { return true }
    get template() { return null }

    onBeforeCreated() { /* abstract */ }
    onCreated() { /* abstract */}
    onBeforeRender() { /* abstract */ }
    onAfterRender() { /* abstract */ }
    update() {
        this._executeBindings()
    }

    render(template) {
        this.alternateTemplate = template
        this.initialize(true)
        this.innerHTML = ''
        this._captureBindings()
        Slim.__moveChildren( this._virtualDOM, this, true )
        this._executeBindings()
    }


    _executeBindings() {
        this._boundChildren.forEach( child => {
            if (child.sourceText) {
                child.textContent = child.sourceText
            }
        })
        Object.keys(this._bindings).forEach( property => {
            this._bindings[property].executors.forEach( fn => { fn() } )
        })
    }

    _captureBindings() {
        let $tpl = this.alternateTemplate || this.template
        if (!$tpl) {
            while (this.children.length) {
                this._virtualDOM.appendChild( this.children[0] )
            }
        } else if (typeof($tpl) === 'string') {
            this._virtualDOM.innerHTML = $tpl
        }

        let allChildren = Array.prototype.slice.call( this._virtualDOM.querySelectorAll('*') )
        for (let child of allChildren) {
            child._boundParent = this
            this._boundChildren.push(child)
            if (child.getAttribute('slim-id')) {
                child._boundParent[ Slim.__dashToCamel(child.getAttribute('slim-id')) ] = child
            }
            let slimID = child.getAttribute('slim-id')
            if (slimID) this[slimID] = child
            let descriptors = []
            if (child.attributes) for (let i = 0; i < child.attributes.length; i++) {
                let desc = Slim.__processAttribute(child.attributes[i])
                if (desc) descriptors.push(desc)
            }

            descriptors = descriptors.sort( (a,b) => {
                if (a.type === 'I') { return -1 }
                else if (a.type === 'R') return 1
                return 0
            })

            descriptors.forEach(
                descriptor => {
                    if (descriptor.type === 'P' || descriptor.type === 'M') {
                        this.__bind(descriptor)
                    } else if (descriptor.type === 'I') {
                        Slim.__inject(descriptor)
                    } else if (descriptor.type === 'R') {
                        Slim.__createRepeater(descriptor)
                        this.__bind(descriptor)
                    }
                }
            )
        }

        allChildren = Array.prototype.slice.call( this._virtualDOM.querySelectorAll('*[bind]'))

        const x = function getDescendantProp(obj, desc) {
            var arr = desc.split(".");
            var prop = arr[0]
            while(arr.length && obj) {
                obj = obj[prop = arr.shift()]
            }
            return {source: desc, prop:prop, obj:obj};
        }

        for (let child of allChildren) {
            let match = child.textContent.match(/\[\[([\w|.]+)\]\]/g)
            if (match) {
                let properties = []
                for (let i = 0; i < match.length; i++) {
                    let lookup = match[i].match(/([^\[].+[^\]])/)[0]
                    properties.push(lookup)
                }
                let descriptor = {
                    type: 'T',
                    properties: properties,
                    target: child,
                    sourceText: child.textContent
                }
                descriptor.target.sourceText = descriptor.sourceText
                this.__bind(descriptor)
            }
        }
    }

}

Slim.__plugins = {
    'create': [],
    'beforeRender': [],
    'afterRender': []
}

Slim.tag('slim-repeat', class extends Slim {
    get sourceData() {
        try {
            return this._boundParent[ this.getAttribute('source') ]
        }
        catch (err) {
            return []
        }
    }

    get isVirtual() {
        return false
    }

    renderList() {
        if (!this.sourceNode) return
        this.clones = []
        this.innerHTML = ''
        for (let dataItem of this.sourceData) {
            let clone = this.sourceNode.cloneNode(true)
            clone.removeAttribute('slim-repeat')
            clone._boundParent = clone
            clone.data = dataItem
            clone.sourceText = clone.textContent
            this.clones.push(clone)
            this.insertAdjacentElement('beforeEnd', clone)
        }
        this._captureBindings()
        for (let clone of this.clones) {
            clone.textContent = clone.sourceText
            clone.data = clone.data
            clone._boundParent = clone
        }
        this._executeBindings()
        Slim.__moveChildren(this._virtualDOM, this, true)

    }
})

Slim.tag('slim-element', class extends Slim {})