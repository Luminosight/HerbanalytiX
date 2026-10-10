import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    Image,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width, height } = Dimensions.get('window');

const SLIDES = [
  {
    id: 'intro',
    tag: 'PRESENTED BY',
    title: null,
    body: 'A thesis project by the Ohmmigos research group',
    type: 'logos',
    accent: '#74C69D',
  },
  {
    id: 'welcome',
    tag: 'WELCOME',
    title: 'HerbanalytiX',
    body: 'An intelligent aeroponics monitoring system designed for precision plant growth and automated control.',
    type: 'app',
    image: require('../../assets/images/hxg.png'),
    accent: '#74C69D',
  },
  {
    id: 'sensors',
    tag: 'LIVE MONITORING',
    title: 'Real-Time\nSensor Data',
    body: 'Monitor pH, TDS, Temperature, and Humidity. Readings are averaged every 10 seconds for accuracy.',
    type: 'standard',
    image: require('../../assets/images/raspi5.png'),
    accent: '#60A5FA',
  },
  {
    id: 'plants',
    tag: 'PLANT PHASES',
    title: 'Track Growth\nPhases',
    body: 'Monitor your plants from Seedling to Vegetative stage across all 6 aeroponic slots simultaneously.',
    type: 'plants',
    accent: '#34D399',
  },
  {
    id: 'ready',
    tag: 'GET STARTED',
    title: 'Your Device\nIs Ready',
    body: 'Power on your HerbanalytiX device and make sure it is connected to the same network as your phone.',
    type: 'ready',
    accent: '#74C69D',
    isLast: true,
  },
];

function Tag({ slide }) {
  return (
    <View style={[styles.tag, {
      backgroundColor: slide.accent + '18',
      borderColor: slide.accent + '44',
    }]}>
      <View style={[styles.tagDot, { backgroundColor: slide.accent }]} />
      <Text style={[styles.tagText, { color: slide.accent }]}>{slide.tag}</Text>
    </View>
  );
}

// Slide 1 — logos in a single row
function LogosSlide({ slide }) {
  const scales = [
    useRef(new Animated.Value(0.6)).current,
    useRef(new Animated.Value(0.6)).current,
    useRef(new Animated.Value(0.6)).current,
    useRef(new Animated.Value(0.6)).current,
  ];
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.stagger(100, scales.map(s =>
        Animated.spring(s, { toValue: 1, tension: 65, friction: 9, useNativeDriver: true })
      )),
    ]).start();
  }, []);

  const logos = [
    require('../../assets/images/1.png'),
    require('../../assets/images/2.png'),
    require('../../assets/images/3.png'),
    require('../../assets/images/4.png'),
  ];

  const LOGO = (width - 80) / 4;

  return (
    <Animated.View style={[styles.slideWrap, { opacity: fadeIn }]}>
      <Tag slide={slide} />

      <View style={styles.logosRow}>
        {logos.map((src, i) => (
          <Animated.View key={i} style={{ transform: [{ scale: scales[i] }] }}>
            <View style={[styles.logoCircle, {
              width: LOGO, height: LOGO, borderRadius: LOGO / 2,
              backgroundColor: slide.accent + '0E',
              borderColor: slide.accent + '28',
            }]}>
              <Image
                source={src}
                style={{ width: LOGO * 0.62, height: LOGO * 0.62 }}
                resizeMode="contain"
              />
            </View>
          </Animated.View>
        ))}
      </View>

      <Text style={[styles.body, { textAlign: 'center' }]}>{slide.body}</Text>
    </Animated.View>
  );
}

// Slide 2 — app logo with pulse
function AppSlide({ slide }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.05, duration: 2200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 2200, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <View style={styles.slideWrap}>
      <Tag slide={slide} />
      <View style={styles.appLogoWrap}>
        <Animated.View style={[styles.glowRingOuter, {
          borderColor: slide.accent + '18', transform: [{ scale: pulse }],
        }]} />
        <Animated.View style={[styles.glowRingInner, {
          borderColor: slide.accent + '30', transform: [{ scale: pulse }],
        }]} />
        <View style={[styles.appLogoBg, {
          backgroundColor: slide.accent + '12',
          borderColor: slide.accent + '30',
        }]}>
          <Image source={slide.image} style={styles.appLogoImg} resizeMode="contain" />
        </View>
      </View>
      <Text style={[styles.title, { textAlign: 'center' }]}>{slide.title}</Text>
      <Text style={[styles.body, { textAlign: 'center' }]}>{slide.body}</Text>
    </View>
  );
}

// Slide 3 — raspi sensor slide
function StandardSlide({ slide }) {
  return (
    <View style={styles.slideWrap}>
      <Tag slide={slide} />
      <View style={styles.imageContainer}>
        <View style={[styles.imageBg, {
          backgroundColor: slide.accent + '10',
          borderColor: slide.accent + '25',
        }]}>
          <Image source={slide.image} style={styles.image} resizeMode="contain" />
        </View>
      </View>
      <Text style={[styles.title, { textAlign: 'center' }]}>{slide.title}</Text>
      <Text style={[styles.body, { textAlign: 'center' }]}>{slide.body}</Text>
    </View>
  );
}

// Slide 4 — plants overlapping row
function PlantsSlide({ slide }) {
  const slideLeft  = useRef(new Animated.Value(-30)).current;
  const slideRight = useRef(new Animated.Value(30)).current;
  const fadeLeft   = useRef(new Animated.Value(0)).current;
  const fadeCenter = useRef(new Animated.Value(0)).current;
  const fadeRight  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.stagger(120, [
      Animated.parallel([
        Animated.timing(fadeCenter, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(fadeLeft, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.spring(slideLeft, { toValue: 0, tension: 55, friction: 10, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(fadeRight, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.spring(slideRight, { toValue: 0, tension: 55, friction: 10, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  const PLANT_H = 160;
  const PLANT_W = 100;

  return (
    <View style={styles.slideWrap}>
      <Tag slide={slide} />

      <View style={styles.plantsRow}>
        {/* Seedling — left */}
        <Animated.View style={[styles.plantItem, {
          opacity: fadeLeft,
          transform: [{ translateX: slideLeft }],
          zIndex: 1, marginRight: -24,
        }]}>
          <Image
            source={require('../../assets/images/Seedling.png')}
            style={{ width: PLANT_W * 0.72, height: PLANT_H * 0.72 }}
            resizeMode="contain"
          />
        </Animated.View>

        {/* Vegetative — center, tallest */}
        <Animated.View style={[styles.plantItem, {
          opacity: fadeCenter,
          zIndex: 3,
        }]}>
          <Image
            source={require('../../assets/images/Young.png')}
            style={{ width: PLANT_W, height: PLANT_H }}
            resizeMode="contain"
          />
        </Animated.View>
      </View>

      <Text style={[styles.title, { textAlign: 'center' }]}>{slide.title}</Text>
      <Text style={[styles.body, { textAlign: 'center' }]}>{slide.body}</Text>
    </View>
  );
}

// Slide 5 — ready, no image
function ReadySlide({ slide }) {
  const scale = useRef(new Animated.Value(0.8)).current;
  const fade  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, tension: 55, friction: 9, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={styles.slideWrap}>
      <Tag slide={slide} />

      <Animated.View style={[styles.readyIcon, {
        backgroundColor: slide.accent + '14',
        borderColor: slide.accent + '35',
        transform: [{ scale }],
        opacity: fade,
      }]}>
        <Text style={styles.readyEmoji}>✓</Text>
      </Animated.View>

      <Text style={[styles.title, { textAlign: 'center' }]}>{slide.title}</Text>
      <Text style={[styles.body, { textAlign: 'center' }]}>{slide.body}</Text>
    </View>
  );
}

export default function OnboardingScreen({ onDone }) {
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(0);
  const fadeAnim    = useRef(new Animated.Value(1)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;

  // Individual dot scale animations
  const dotScales = SLIDES.map((_, i) => useRef(new Animated.Value(i === 0 ? 1 : 0.7)).current);

  const slide  = SLIDES[currentIndex];
  const isLast = currentIndex === SLIDES.length - 1;

  // Animate active dot
  useEffect(() => {
    SLIDES.forEach((_, i) => {
      Animated.spring(dotScales[i], {
        toValue: i === currentIndex ? 1.2 : 0.7,
        tension: 80, friction: 10, useNativeDriver: true,
      }).start();
    });
  }, [currentIndex]);

  const transition = (fn) => {
    Animated.timing(fadeAnim, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => {
      fn();
      Animated.timing(fadeAnim, { toValue: 1, duration: 280, useNativeDriver: true }).start();
    });
  };

  const goNext = () => {
    if (isLast) {
      Animated.sequence([
        Animated.timing(buttonScale, { toValue: 0.94, duration: 80, useNativeDriver: true }),
        Animated.timing(buttonScale, { toValue: 1, duration: 80, useNativeDriver: true }),
      ]).start(() => onDone());
      return;
    }
    transition(() => setCurrentIndex(i => i + 1));
  };

  const goTo = (index) => {
    if (index === currentIndex) return;
    transition(() => setCurrentIndex(index));
  };

  const renderSlide = () => {
    switch (slide.type) {
      case 'logos':    return <LogosSlide slide={slide} />;
      case 'app':      return <AppSlide slide={slide} />;
      case 'standard': return <StandardSlide slide={slide} />;
      case 'plants':   return <PlantsSlide slide={slide} />;
      case 'ready':    return <ReadySlide slide={slide} />;
    }
  };

  return (
    <LinearGradient
      colors={['#040F0A', '#071A0F', '#0A1F14']}
      style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}
    >
      {/* Ambient glow */}
      <View style={[styles.ambientGlow, { backgroundColor: slide.accent }]} />

      {/* Skip */}
      {!isLast && (
        <TouchableOpacity
          style={[styles.skipBtn, { top: insets.top + 12 }]}
          onPress={onDone}
          activeOpacity={0.7}
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      )}

      {/* Slide content */}
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        {renderSlide()}
      </Animated.View>

      {/* Bottom controls */}
      <View style={styles.bottom}>

        {/* Dots with animated scale */}
        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
            <TouchableOpacity key={i} onPress={() => goTo(i)} activeOpacity={0.7}>
              <Animated.View style={[
                styles.dot,
                {
                  backgroundColor: i === currentIndex ? slide.accent : 'rgba(255,255,255,0.15)',
                  width: i === currentIndex ? 28 : 8,
                  transform: [{ scale: dotScales[i] }],
                },
              ]} />
            </TouchableOpacity>
          ))}
        </View>

        {/* CTA button */}
        <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: slide.accent }]}
            onPress={goNext}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>{isLast ? 'Get Started' : 'Continue'}</Text>
            <Text style={styles.btnArrow}>→</Text>
          </TouchableOpacity>
        </Animated.View>

      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  ambientGlow: {
    position: 'absolute',
    width: width, height: 280,
    top: -140, alignSelf: 'center',
    opacity: 0.06, borderRadius: width / 2,
  },

  skipBtn: {
    position: 'absolute', right: 24, zIndex: 10,
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  skipText: { color: 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: '600' },

  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 16,
    justifyContent: 'center',
  },

  slideWrap: { alignItems: 'center', width: '100%' },

  // Tag pill
  tag: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1,
    gap: 6, marginBottom: 28,
  },
  tagDot: { width: 6, height: 6, borderRadius: 3 },
  tagText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },

  // Shared text
  title: {
    fontSize: 36, fontWeight: '900',
    color: '#ECFDF5', letterSpacing: -1,
    lineHeight: 42, marginBottom: 14,
  },
  body: {
    fontSize: 15, color: 'rgba(236,253,245,0.5)',
    lineHeight: 24, fontWeight: '400',
    paddingHorizontal: 8,
  },

  // LOGOS
  logosRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
    marginBottom: 28,
  },
  logoCircle: {
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },

  // APP LOGO
  appLogoWrap: {
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 28,
  },
  glowRingOuter: {
    position: 'absolute',
    width: 210, height: 210, borderRadius: 105, borderWidth: 1,
  },
  glowRingInner: {
    position: 'absolute',
    width: 170, height: 170, borderRadius: 85, borderWidth: 1,
  },
  appLogoBg: {
    width: 140, height: 140, borderRadius: 70,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  appLogoImg: { width: 120, height: 46 },

  // STANDARD
  imageContainer: { alignItems: 'center', marginBottom: 28 },
  imageBg: {
    width: 150, height: 150, borderRadius: 75,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  image: { width: 100, height: 100 },

  // PLANTS
  plantsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginBottom: 28,
    height: 170,
  },
  plantItem: { alignItems: 'center', justifyContent: 'flex-end' },

  // READY
  readyIcon: {
    width: 100, height: 100, borderRadius: 50,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, marginBottom: 28,
  },
  readyEmoji: { fontSize: 42, color: '#74C69D', fontWeight: '900' },

  // Bottom
  bottom: { paddingHorizontal: 28, gap: 20 },
  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  dot: { height: 8, borderRadius: 4 },
  btn: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18, borderRadius: 20, gap: 8,
  },
  btnText: { color: '#061410', fontSize: 17, fontWeight: '900', letterSpacing: 0.3 },
  btnArrow: { color: '#061410', fontSize: 18, fontWeight: '900' },
});