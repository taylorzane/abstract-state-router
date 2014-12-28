var StateState = require('./state-state')
var extend = require('extend')
var Promise = require('promise')
var StateComparison = require('./state-comparison')
var CurrentState = require('./current-state')
var stateChangeLogic = require('./state-change-logic')
var newHashBrownRouter = require('hash-brown-router')
var EventEmitter = require('events').EventEmitter
var series = require('promise-map-series')
var parse = require('../state-string-parser')

function onRouteChange(stateHolder, currentState, stateComparison, activeStates, state, parameters) {
	// originalState, originalParameters, newState, newParameters
	var stateComparisonResults = stateComparison(currentState.get().name, currentState.get().parameters, state.name, parameters)
	var stateChangeActions = stateChangeLogic(stateComparisonResults)

	// { destroy, change, create }

	return handleStateChange(stateHolder, stateChangeActions, activeStates, parameters)

}

module.exports = function StateProvider(render, rootElement, hashRouter) {
	render = Promise.denodeify(render)
	var prototypalStateHolder = StateState()
	var current = CurrentState()
	var stateProviderEmitter = new EventEmitter()
	// hashRouter = hashRouter || newHashBrownRouter()

	var activeDomElementsAndEmitters = {}

	function destroyStateName(stateName) {
		activeDomElementsAndEmitters[stateName].emit('destroy')
		delete activeDomElementsAndEmitters[stateName]
	}

	function renderStateName(stateName) {
		var state = prototypalStateHolder.get(stateName)
		var parent = getParent(stateName)
		var element = parent ? parent.childElement : rootElement
		var emitter = new EventEmitter()

		activeDomElementsAndEmitters[stateName] = emitter

		return render(element, parent.template, emitter)
	}

	function renderAll(stateNames) {
		return series(stateNames, renderStateName).then(function(childElements) {
			combine({
				name: stateNames,
				childElement: childElements
			}).forEach(function(stateAndChild) {
				activeDomElementsAndEmitters[stateAndChild.name].childElement = stateAndChild.childElement
			})
		})
	}

	current.set('', {})

	function addState(state) {
		prototypalStateHolder.add(state.name, state)

		var route = buildRoute(prototypalStateHolder, state.name)

		// hashRouter.add(route, onRouteChange.bind(null, prototypalStateHolder, current, stateComparison, activeDomElementsAndEmitters, state))
	}

	stateProviderEmitter.addState = addState
	stateProviderEmitter.go = function go(newStateName, parameters) {
		stateProviderEmitter.emit('state change started', newStateName)
		var stateComparisonResults = stateComparison(prototypalStateHolder)(current.get().name, current.get().parameters, newStateName, parameters)
		var stateChanges = stateChangeLogic(stateComparisonResults)
		// { destroy, change, create }

		var statesToResolve = stateChanges.change.concat(stateChanges.create).map(prototypalStateHolder.get)

		resolveStates(statesToResolve).then(function afterResolves(stateResolveResultsObject) {
			reverse(stateChanges.destroy).forEach(destroyStateName)

			renderAll(stateChanges.create).then(function() {
				var statesToActivate = stateChange.change.concat(stateChanges.create)

				statesToActivate.map(prototypalStateHolder.get).forEach(function(state) {
					try {
						state.activate(state.data, parameters, getContentObject(stateResolveResultsObject, state.name))
					} catch (e) {
						console.log('Error in activate function', e)
					}
				})
			})

			stateProviderEmitter.emit('state change finished')
		})
	}

	return stateProviderEmitter
}

function getContentObject(stateResolveResultsObject, stateName) {
	var allPossibleResolvedStateNames = parse(stateName)

	return allPossibleResolvedStateNames.filter(function(stateName) {
		return stateResolveResultsObject[stateName]
	}).reduce(function(obj, stateName) {
		return extend(obj, stateResolveResultsObject[stateName])
	}, {})
}

// { [stateName]: resolveResult }
function resolveStates(states) {
	var statesWithResolveFunctions = states.filter(isFunction('resolve'))
	var stateNamesWithResolveFunctions = statesWithResolveFunctions.map(property('name'))
	var resolves = Promise.all(statesWithResolveFunctions.property('resolve'))

	return resolves.then(function(resolveResults) {
		return combine({
			stateName: stateNamesWithResolveFunctions
			resolveResult: resolveResults
		}).reduce(function(obj, result) {
			obj[result.stateName] = result.resolveResult
			return obj
		}, {})
	})
}


function property(name) {
	return function(obj) {
		return obj[name]
	}
}

function isFunction(property) {
	return function(obj) {
		return typeof obj[property] === 'function'
	}
}

function buildRoute(prototypalStateHolder, stateName) {
	return prototypalStateHolder.getHierarchy(stateName).reduce(function(route, stateRouteChunk) {
		if (!route || route[route.length - 1] !== '/') {
			route = route + '/'
		}
		return route + stateRouteChunk
	}, '')
}

function reverse(ary) {
	return [].concat(ary)
}