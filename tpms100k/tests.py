import unittest
import numpy as np
from tpms100k import geometry as g

class GeometryTests(unittest.TestCase):
    def test_source_families(self):
        self.assertEqual(len(g.FAMILIES),9)
        for f in g.FAMILIES:
            p=g.parameters(f['id'],7)
            self.assertEqual(g.field(p).shape,(32,32,32))
            self.assertLess(g.boundary_error(p),1e-10)
    def test_exact_reconstruction_and_density(self):
        p=g.parameters('gyroid-sheet',7)
        v,t,d=g.tune(p,.213,.21,.214)
        np.testing.assert_array_equal(v,g.recreate({'geometry':p,'threshold':t}))
        self.assertTrue(.21<=d<.214)
    def test_rotation_duplicate(self):
        v=np.random.default_rng(3).random((8,)*3)>.7
        self.assertEqual(g.hashes(v)[1],g.hashes(v.transpose(2,0,1)[::-1])[1])
    def test_mesh_alignment(self):
        p=g.parameters('gyroid-sheet',1); v,t,_=g.tune(p,.2,.19,.21)
        points,faces=g.mesh_arrays({'geometry':p,'threshold':t},32)
        self.assertTrue(np.all(np.abs(points)<=1))
        self.assertGreater(len(faces),0)
        self.assertTrue(np.allclose(points.min(axis=0),-1))
        self.assertTrue(np.allclose(points.max(axis=0),1))
    def test_periodic_winding_rank(self):
        from scipy.ndimage import label
        solid=np.ones((8,8,8),dtype=bool)
        labs,n=label(solid)
        self.assertEqual(g.periodic_connectivity(labs,n),(1,3))
        solid[:]=False;solid[2:5,2:5,2:5]=True
        labs,n=label(solid)
        self.assertEqual(g.periodic_connectivity(labs,n),(1,0))
        solid[:]=False;solid[:,2:5,2:5]=True
        labs,n=label(solid)
        self.assertEqual(g.periodic_connectivity(labs,n),(1,1))

if __name__=='__main__':unittest.main()
