import AVFoundation
import AVKit
import ExpoModulesCore

/**
 * Native half of `AirPlayPlaybackSource` (PLAN.md Section 11, Sprint 8). AVKit/AVFoundation only —
 * Section 12 lists iOS AirPlay APIs as a free native integration, so there is no third-party cast
 * SDK here (that exception applies to Chromecast only).
 *
 * Surface is deliberately the three things the TS `AirPlayRouteController` boundary needs: is a
 * target discoverable, what is the active route called (for Section 10's "Cast to {target}" CTA),
 * and present the system route picker.
 */
public final class AirPlayRouteModule: Module {
  private var routeDetector: AVRouteDetector?
  private var availabilityObservation: NSKeyValueObservation?

  /// Held only while a picker sheet is on screen. `AVRoutePickerView` does not retain its delegate,
  /// and a picker removed from the hierarchy dismisses its own sheet, so both need an owner here.
  private var activePicker: AVRoutePickerView?
  private var activePickerDelegate: RoutePickerDelegate?

  /**
   * Mirror of `routeDetector.multipleRoutesDetected`, maintained on the main thread by the KVO
   * handler below. Cached rather than read on demand because AVRouteDetector is main-thread-only
   * while a synchronous Expo `Function` runs on the JS thread — a `DispatchQueue.main.sync` hop
   * there would risk deadlocking against a main-thread JS call.
   */
  private var targetAvailable = false

  public func definition() -> ModuleDefinition {
    Name("AirPlayRoute")

    Events("onTargetAvailabilityChange")

    OnCreate {
      DispatchQueue.main.async { [weak self] in
        self?.startRouteDetection()
      }
    }

    OnDestroy {
      // Route detection keeps a discovery radio active, so it must not outlive the module.
      let observation = self.availabilityObservation
      let detector = self.routeDetector
      self.availabilityObservation = nil
      self.routeDetector = nil
      DispatchQueue.main.async {
        observation?.invalidate()
        detector?.isRouteDetectionEnabled = false
      }
    }

    Function("isTargetAvailable") { () -> Bool in
      return self.targetAvailable
    }

    /// `nil` whenever audio is not currently routed to an AirPlay output — which is also the
    /// "route picked, but this app is not the one playing" case, so callers must treat it as a hint
    /// rather than proof that a target is receiving video.
    Function("activeRouteName") { () -> String? in
      let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
      return outputs.first { $0.portType == .airPlay }?.portName
    }

    /**
     * Presents the system AirPlay route picker. `AVRoutePickerView` is a button rather than an API,
     * so a host button is added to the window and its action fired — the route to the same system
     * sheet without shipping our own device list.
     *
     * Resolves only once the sheet has been *dismissed*, reporting whether an AirPlay output is
     * actually active afterwards. Resolving at presentation time instead is what made the first
     * device run hand off to the streaming app ~700ms later and tear the sheet down before it could
     * be used.
     */
    AsyncFunction("presentRoutePicker") { (promise: Promise) in
      DispatchQueue.main.async {
        guard let window = Self.activeKeyWindow() else {
          promise.reject(
            GenericException<String>("No key window is available to present the AirPlay route picker.")
          )
          return
        }

        // Not `alpha = 0` / `isHidden`: a fully invisible view does not reliably present the sheet.
        // A 1pt, all-but-transparent host stays presentable while being effectively unseen.
        let picker = AVRoutePickerView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        picker.prioritizesVideoDevices = true
        picker.alpha = 0.01
        window.addSubview(picker)

        var settled = false
        let finish: () -> Void = { [weak self] in
          guard !settled else { return }
          settled = true
          let routedToAirPlay = AVAudioSession.sharedInstance().currentRoute.outputs
            .contains { $0.portType == .airPlay }
          self?.activePicker?.removeFromSuperview()
          self?.activePicker = nil
          self?.activePickerDelegate = nil
          promise.resolve(routedToAirPlay)
        }

        let delegate = RoutePickerDelegate(onEndPresenting: finish)
        picker.delegate = delegate
        self.activePicker = picker
        self.activePickerDelegate = delegate

        guard let button = picker.subviews.compactMap({ $0 as? UIButton }).first else {
          self.activePicker = nil
          self.activePickerDelegate = nil
          picker.removeFromSuperview()
          promise.reject(
            GenericException<String>(
              "AVRoutePickerView exposed no button to trigger on this iOS version."
            )
          )
          return
        }

        button.sendActions(for: .touchUpInside)

        // Safety net: if the sheet never presents, the delegate callback never fires and the switch
        // would hang forever. Fall through rather than trapping the user mid-switch.
        DispatchQueue.main.asyncAfter(deadline: .now() + 45) { finish() }
      }
    }
  }

  /// Main thread only (AVRouteDetector requirement).
  private func startRouteDetection() {
    #if targetEnvironment(simulator)
    // AVRouteDetector requires real AirPlay route discovery hardware/networking that the
    // Simulator doesn't provide. There, `multipleRoutesDetected`'s KVO change value comes back
    // malformed and the `.observe` call below aborts the process on launch (Swift's KVO bridging
    // hits a forced cast it can't satisfy) — 100% reproducible, not a race. Leave
    // `targetAvailable` at its `false` default instead; this is a device-only feature regardless.
    return
    #else
    let detector = AVRouteDetector()
    detector.isRouteDetectionEnabled = true
    routeDetector = detector

    availabilityObservation = detector.observe(
      \.multipleRoutesDetected,
      options: [.initial, .new]
    ) { [weak self] detector, _ in
      guard let self else { return }
      let available = detector.multipleRoutesDetected
      guard available != self.targetAvailable else { return }
      self.targetAvailable = available
      self.sendEvent("onTargetAvailabilityChange", ["available": available])
    }
    #endif
  }

  /// Bridges `AVRoutePickerViewDelegate`'s dismissal callback to a closure. Separate object because
  /// `Module` cannot conform to it without leaking the delegate's lifetime into the module's.
  fileprivate final class RoutePickerDelegate: NSObject, AVRoutePickerViewDelegate {
    private let onEndPresenting: () -> Void

    init(onEndPresenting: @escaping () -> Void) {
      self.onEndPresenting = onEndPresenting
      super.init()
    }

    func routePickerViewDidEndPresentingRoutes(_ routePickerView: AVRoutePickerView) {
      onEndPresenting()
    }
  }

  private static func activeKeyWindow() -> UIWindow? {
    return UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .filter { $0.activationState == .foregroundActive }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
      ?? UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap { $0.windows }
        .first
  }
}