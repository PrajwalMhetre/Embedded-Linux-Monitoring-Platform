import "@testing-library/jest-dom/vitest";

class ResizeObserverMock implements ResizeObserver {
	constructor(_callback: ResizeObserverCallback) {}
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

Object.defineProperty(globalThis, "ResizeObserver", { writable: true, value: ResizeObserverMock });